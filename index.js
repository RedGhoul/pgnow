require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const moment = require('moment');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Security headers
app.use(helmet());

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// PostgreSQL connection pool with production settings
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  pool.end(() => {
    console.log('Database pool has ended');
    process.exit(0);
  });
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Connected to PostgreSQL database at:', res.rows[0].now);
  }
});

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session configuration with secure settings
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
    sameSite: 'strict'
  }
}));
app.use(flash());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Make moment available in all views
app.locals.moment = moment;

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Routes
app.get('/', async (req, res) => {
  try {
    // Get database status
    const dbStatus = await pool.query(`
      SELECT version(),
             CASE 
               WHEN extract(day from current_timestamp - pg_postmaster_start_time()) > 0 
               THEN extract(day from current_timestamp - pg_postmaster_start_time())::text || ' days ' 
               ELSE '' 
             END ||
             CASE 
               WHEN extract(hour from current_timestamp - pg_postmaster_start_time()) > 0 
               THEN extract(hour from current_timestamp - pg_postmaster_start_time())::text || ' hours ' 
               ELSE '' 
             END ||
             CASE 
               WHEN extract(minute from current_timestamp - pg_postmaster_start_time()) > 0 
               THEN extract(minute from current_timestamp - pg_postmaster_start_time())::text || ' minutes' 
               ELSE '0 minutes' 
             END as uptime
    `);
    
    // Get connection info
    const connectionInfo = await pool.query(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
    `);
    
    // Get max connections
    const maxConnections = await pool.query('SHOW max_connections');
    
    // Get storage information
    const storageInfo = await pool.query(`
      WITH TableSizes AS (
        SELECT 
          schemaname,
          relname as table_name,
          pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) as total_bytes,
          pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as total_size,
          pg_size_pretty(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as table_size,
          pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) - 
                        pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) as index_size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)) DESC
        LIMIT 5
      )
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        pg_size_pretty(sum(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)))) as tables_size,
        pg_size_pretty(sum(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) - 
                      sum(pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname)))) as indexes_size,
        (SELECT array_to_json(array_agg(row_to_json(t))) FROM TableSizes t) as largest_tables
      FROM pg_stat_user_tables
    `);
    
    // Get top 5 largest tables
    const largestTables = JSON.parse(storageInfo.rows[0].largest_tables || '[]');

    // Get query statistics
    const queryStats = await pool.query(`
      SELECT 
        COALESCE(sum(xact_commit), 0) + COALESCE(sum(xact_rollback), 0) as total_queries,
        COALESCE(sum(tup_returned), 0) as rows_returned,
        COALESCE(sum(tup_fetched), 0) as rows_fetched,
        COALESCE(sum(tup_inserted), 0) as rows_inserted,
        COALESCE(sum(tup_updated), 0) as rows_updated,
        COALESCE(sum(tup_deleted), 0) as rows_deleted,
        CASE 
          WHEN COALESCE(sum(xact_commit), 0) + COALESCE(sum(xact_rollback), 0) > 0 
          THEN round(100.0 * sum(xact_commit) / (sum(xact_commit) + sum(xact_rollback)), 2)
          ELSE 100 
        END as success_rate
      FROM pg_stat_database 
      WHERE datname IS NOT NULL
    `);

    // Get database activity
    const dbActivity = await pool.query(`
      SELECT 
        count(*) FILTER (WHERE state = 'active' AND query NOT LIKE '%pg_stat%') as active_queries,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
        extract(epoch from now() - backend_start)::integer as session_time,
        query,
        state,
        wait_event_type
      FROM pg_stat_activity 
      WHERE datname = current_database()
      GROUP BY query, state, wait_event_type, backend_start
      ORDER BY session_time DESC
      LIMIT 5
    `);
    
    // Render the dashboard with all collected data
    res.render('dashboard', {
      dbStatus: dbStatus.rows[0],
      connectionInfo: connectionInfo.rows[0],
      maxConnections: maxConnections.rows[0].max_connections,
      storageInfo: storageInfo.rows[0],
      largestTables: largestTables,
      queryStats: queryStats.rows[0],
      dbActivity: dbActivity.rows,
      flash: req.flash()
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    req.flash('error', 'Failed to fetch database metrics');
    res.render('dashboard', { error: error.message, flash: req.flash() });
  }
});

// New route to display all databases
app.get('/databases', async (req, res) => {
  try {
    // Get list of all databases
    const dbListResult = await pool.query(`
      SELECT 
        d.datname as name,
        pg_size_pretty(pg_database_size(d.datname)) as size,
        u.usename as owner,
        pg_encoding_to_char(d.encoding) as encoding,
        d.datcollate as collation,
        d.datctype as ctype,
        CASE WHEN pg_catalog.has_database_privilege(d.datname, 'CONNECT')
             THEN 'Yes' ELSE 'No' END as has_access,
        s.numbackends as connections,
        s.xact_commit as commits,
        s.xact_rollback as rollbacks,
        s.blks_read as blocks_read,
        s.blks_hit as blocks_hit,
        s.tup_returned as rows_returned,
        s.tup_fetched as rows_fetched,
        s.tup_inserted as rows_inserted,
        s.tup_updated as rows_updated,
        s.tup_deleted as rows_deleted
      FROM pg_catalog.pg_database d
      JOIN pg_catalog.pg_user u ON d.datdba = u.usesysid
      LEFT JOIN pg_stat_database s ON d.datname = s.datname
      WHERE d.datistemplate = false
      ORDER BY pg_database_size(d.datname) DESC
    `);

    // Render the databases view with the data
    res.render('databases', {
      databases: dbListResult.rows,
      currentDb: process.env.DB_NAME,
      flash: req.flash()
    });
  } catch (error) {
    console.error('Error fetching databases list:', error);
    req.flash('error', 'Failed to fetch databases list');
    res.render('databases', { error: error.message, flash: req.flash() });
  }
});

// API endpoints for AJAX updates
app.get('/api/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 as status');
    res.json({ status: 'up' });
  } catch (error) {
    res.json({ status: 'down', error: error.message });
  }
});

app.get('/api/performance', async (req, res) => {
  try {
    // Get performance metrics
    const performanceMetrics = await pool.query(`
      SELECT 
        xact_commit as commits,
        xact_rollback as rollbacks,
        blks_read as blocks_read,
        blks_hit as blocks_hit,
        tup_returned as rows_returned,
        tup_fetched as rows_fetched,
        tup_inserted as rows_inserted,
        tup_updated as rows_updated,
        tup_deleted as rows_deleted
      FROM pg_stat_database
      WHERE datname = current_database()
    `);
    
    res.json(performanceMetrics.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// New route for database health insights
app.get('/health', async (req, res) => {
  try {
    // Get overall database statistics
    const dbStats = await pool.query(`
      SELECT 
        pg_size_pretty(sum(pg_database_size(datname))) as total_size,
        count(*) as total_databases
      FROM pg_database
      WHERE datistemplate = false
    `);

    // Get cache hit ratios
    const cacheStats = await pool.query(`
      SELECT 
        sum(blks_hit) as cache_hits,
        sum(blks_read) as disk_reads,
        CASE WHEN sum(blks_hit) + sum(blks_read) > 0
          THEN round(100 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)), 2)
          ELSE 0
        END as cache_hit_ratio
      FROM pg_stat_database
      WHERE datname = current_database()
    `);

    // Get transaction statistics
    const txStats = await pool.query(`
      SELECT 
        sum(xact_commit) as total_commits,
        sum(xact_rollback) as total_rollbacks,
        CASE WHEN sum(xact_commit) + sum(xact_rollback) > 0
          THEN round(100 * sum(xact_commit)::numeric / (sum(xact_commit) + sum(xact_rollback)), 2)
          ELSE 0
        END as commit_ratio,
        sum(tup_inserted) as rows_inserted,
        sum(tup_updated) as rows_updated,
        sum(tup_deleted) as rows_deleted
      FROM pg_stat_database
      WHERE datname = current_database()
    `);

    // Get connection utilization
    const connStats = await pool.query(`
      SELECT 
        count(*) as active_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
        round(count(*)::numeric * 100 / (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'), 2) as connection_utilization
      FROM pg_stat_activity
      WHERE state = 'active'
    `);

    // Get lock statistics
    const lockStats = await pool.query(`
      SELECT 
        mode,
        count(*) as count,
        CASE 
          WHEN granted THEN 'Granted'
          ELSE 'Waiting'
        END as status
      FROM pg_locks
      GROUP BY mode, granted
      ORDER BY count DESC
    `);

    // Get index health
    const indexHealth = await pool.query(`
      SELECT 
        schemaname,
        relname as table_name,
        indexrelname as index_name,
        idx_scan as number_of_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        CASE WHEN idx_scan > 0 THEN 'Active' ELSE 'Unused' END as index_status
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
      AND schemaname NOT IN ('pg_catalog', 'pg_toast')
      ORDER BY schemaname, relname
    `);

    // Get table bloat estimation
    const tableBloat = await pool.query(`
      WITH UserTables AS (
        SELECT c.oid,
               n.nspname as schemaname,
               c.relname as tablename,
               c.reltuples as estimate_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_toast'
      )
      SELECT 
        ut.schemaname,
        ut.tablename as table_name,
        COALESCE(ps.n_live_tup, ut.estimate_rows::bigint) as live_rows,
        COALESCE(ps.n_dead_tup, 0) as dead_rows,
        CASE 
          WHEN COALESCE(ps.n_live_tup, ut.estimate_rows::bigint) + COALESCE(ps.n_dead_tup, 0) > 0
          THEN round(100.0 * COALESCE(ps.n_dead_tup, 0)::numeric / 
               (COALESCE(ps.n_live_tup, ut.estimate_rows::bigint) + COALESCE(ps.n_dead_tup, 0)), 2)
          ELSE 0 
        END as bloat_ratio
      FROM UserTables ut
      LEFT JOIN pg_stat_user_tables ps 
        ON ps.schemaname = ut.schemaname 
        AND ps.relname = ut.tablename
      WHERE COALESCE(ps.n_live_tup, ut.estimate_rows::bigint) > 0
      ORDER BY COALESCE(ps.n_dead_tup, 0) DESC, bloat_ratio DESC
      LIMIT 10
    `);

    // Get vacuum statistics
    const vacuumStats = await pool.query(`
      WITH UserTables AS (
        SELECT c.oid,
               n.nspname as schemaname,
               c.relname as tablename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_toast'
      )
      SELECT
        ut.schemaname,
        ut.tablename as table_name,
        COALESCE(ps.last_vacuum, ps.last_autovacuum) as last_vacuum,
        ps.last_autovacuum,
        COALESCE(ps.vacuum_count, 0) as vacuum_count,
        COALESCE(ps.autovacuum_count, 0) as autovacuum_count,
        COALESCE(ps.n_live_tup, 0) as row_count,
        age(clock_timestamp(), COALESCE(ps.last_vacuum, ps.last_autovacuum)) as time_since_vacuum
      FROM UserTables ut
      LEFT JOIN pg_stat_user_tables ps 
        ON ps.schemaname = ut.schemaname 
        AND ps.relname = ut.tablename
      ORDER BY time_since_vacuum DESC NULLS FIRST
      LIMIT 10
    `);

    // Get long-running queries
    const longQueries = await pool.query(`
      SELECT 
        pid,
        usename,
        application_name,
        state,
        CASE 
          WHEN extract(day from age(clock_timestamp(), query_start)) > 0 
          THEN extract(day from age(clock_timestamp(), query_start))::text || ' days '
          ELSE '' 
        END ||
        CASE 
          WHEN extract(hour from age(clock_timestamp(), query_start)) > 0 
          THEN extract(hour from age(clock_timestamp(), query_start))::text || ' hours '
          ELSE '' 
        END ||
        CASE 
          WHEN extract(minute from age(clock_timestamp(), query_start)) > 0 
          THEN extract(minute from age(clock_timestamp(), query_start))::text || ' min '
          ELSE '' 
        END ||
        CASE 
          WHEN extract(second from age(clock_timestamp(), query_start)) > 0 
          THEN round(extract(second from age(clock_timestamp(), query_start)))::text || ' sec'
          ELSE '0 sec' 
        END as query_duration,
        query
      FROM pg_stat_activity
      WHERE state != 'idle'
        AND query NOT LIKE '%pg_stat%'
        AND query NOT LIKE 'SELECT pid,usename%'
        AND age(clock_timestamp(), query_start) > interval '5 seconds'
      ORDER BY age(clock_timestamp(), query_start) DESC
      LIMIT 10
    `);

    console.log('Table Bloat Data:', tableBloat.rows);
    console.log('Vacuum Stats Data:', vacuumStats.rows);
    console.log('Long Queries Data:', longQueries.rows);

    // Render the health dashboard
    res.render('health', {
      dbStats: dbStats.rows[0],
      cacheStats: cacheStats.rows[0],
      txStats: txStats.rows[0],
      connStats: connStats.rows[0],
      lockStats: lockStats.rows,
      indexHealth: indexHealth.rows,
      tableBloat: tableBloat.rows,
      vacuumStats: vacuumStats.rows,
      longQueries: longQueries.rows,
      flash: req.flash()
    });
  } catch (error) {
    console.error('Error fetching health metrics:', error);
    req.flash('error', 'Failed to fetch health metrics');
    res.render('health', { error: error.message, flash: req.flash() });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`PostgreSQL Monitoring Tool running at http://localhost:${port}`);
});
