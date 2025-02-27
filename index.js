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
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "cdn.jsdelivr.net"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "cdn.jsdelivr.net"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
}));

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
  ssl: false, // Disable SSL for local connections
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

// Make moment available in all views
app.locals.moment = moment;

// Routes
app.get('/', async (req, res) => {
  console.log('Root route accessed');
  try {
    console.log('Fetching database status...');
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
    
    console.log('Fetching connection info...');
    // Get connection info
    const connectionInfo = await pool.query(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
    `);
    
    console.log('Fetching max connections...');
    // Get max connections
    const maxConnections = await pool.query('SHOW max_connections');
    
    console.log('Fetching storage info...');
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
    
    // Get individual database sizes
    const dbSizes = await pool.query(`
      SELECT 
        d.datname as name,
        pg_size_pretty(pg_database_size(d.datname)) as size,
        pg_database_size(d.datname) as size_bytes
      FROM pg_catalog.pg_database d
      WHERE d.datistemplate = false
      ORDER BY pg_database_size(d.datname) DESC
    `);
    
    console.log('Parsing largest tables...');
    // Get top 5 largest tables
    const largestTables = JSON.parse(storageInfo.rows[0].largest_tables || '[]');

    console.log('Fetching query stats...');
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

    console.log('Fetching database activity...');
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

    // Get system health metrics
    const systemHealth = await pool.query(`
      SELECT 
        (SELECT CAST(100 * (SELECT COALESCE(SUM(numbackends), 0) FROM pg_stat_database)::float / 
                current_setting('max_connections')::float AS numeric(10,2)) AS connection_ratio),
        (SELECT CAST(100 * COALESCE(blks_hit::float / NULLIF(blks_hit + blks_read, 0), 0) AS numeric(10,2))
         FROM pg_stat_database 
         WHERE datname = current_database()) AS cache_hit_ratio,
        (SELECT CAST(100 * COALESCE(xact_commit::float / NULLIF(xact_commit + xact_rollback, 0), 0) AS numeric(10,2))
         FROM pg_stat_database 
         WHERE datname = current_database()) AS commit_ratio
    `);

    // Get query performance data for the last hour
    const queryPerformance = await pool.query(`
      WITH times AS (
        SELECT generate_series(
          date_trunc('hour', NOW()) - INTERVAL '1 hour',
          date_trunc('minute', NOW()),
          '15 minutes'::interval
        ) AS interval_start
      )
      SELECT 
        to_char(t.interval_start, 'HH24:MI') as time_label,
        COALESCE(COUNT(sa.pid), 0) as queries_per_sec,
        CAST(COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - sa.query_start))), 0) AS numeric(10,2)) as avg_response_time
      FROM times t
      LEFT JOIN pg_stat_activity sa ON 
        sa.query_start >= t.interval_start AND 
        sa.query_start < t.interval_start + '15 minutes'::interval AND
        sa.state = 'active'
      GROUP BY t.interval_start
      ORDER BY t.interval_start;
    `);

    console.log('Rendering dashboard...');
    // Render the dashboard with all collected data
    res.render('dashboard', {
      dbStatus: dbStatus.rows[0],
      connectionInfo: connectionInfo.rows[0],
      maxConnections: maxConnections.rows[0].max_connections,
      storageInfo: storageInfo.rows[0],
      largestTables: largestTables,
      queryStats: queryStats.rows[0],
      dbActivity: dbActivity.rows,
      databases: dbSizes.rows,
      systemHealth: systemHealth.rows[0],
      queryPerformance: queryPerformance.rows,
      flash: req.flash()
    });
  } catch (error) {
    console.error('Error in root route:', error);
    req.flash('error', 'Failed to fetch database metrics');
    res.render('dashboard', { error: error.message, flash: req.flash() });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Cache hit ratio and general stats
    const cacheStats = await pool.query(`
      SELECT 
        CASE 
          WHEN blks_hit + blks_read > 0 
          THEN ROUND(100.0 * blks_hit / (blks_hit + blks_read), 2)
          ELSE 100 
        END as cache_hit_ratio
      FROM pg_stat_database 
      WHERE datname = current_database()
    `);

    // Transaction stats
    const txStats = await pool.query(`
      SELECT 
        CASE 
          WHEN xact_commit + xact_rollback > 0 
          THEN ROUND(100.0 * xact_commit / (xact_commit + xact_rollback), 2)
          ELSE 100 
        END as commit_ratio
      FROM pg_stat_database 
      WHERE datname = current_database()
    `);

    // Connection utilization
    const maxConnections = await pool.query('SHOW max_connections');
    const currentConnections = await pool.query(`
      SELECT COUNT(*) as current_connections 
      FROM pg_stat_activity
    `);
    const connStats = {
      connection_utilization: Math.round(
        (currentConnections.rows[0].current_connections / maxConnections.rows[0].max_connections) * 100
      )
    };

    // Database stats
    const dbStats = await pool.query(`
      SELECT 
        pg_size_pretty(sum(pg_database_size(datname))) as total_size,
        count(*) as total_databases
      FROM pg_database 
      WHERE datistemplate = false
    `);

    // Lock statistics
    const lockStats = await pool.query(`
      SELECT 
        mode,
        CASE 
          WHEN granted THEN 'Granted'
          ELSE 'Waiting'
        END as status,
        count(*) as count
      FROM pg_locks
      GROUP BY mode, granted
      ORDER BY mode
    `);

    // Unused indexes
    const indexHealth = await pool.query(`
      SELECT 
        schemaname,
        relname as table_name,
        indexrelname as index_name,
        'Unused' as index_status
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0 
      AND schemaname NOT IN ('pg_catalog', 'pg_toast')
      ORDER BY schemaname, relname
    `);

    // Table bloat information
    const tableBloat = await pool.query(`
      SELECT 
        schemaname,
        relname as table_name,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        CASE 
          WHEN n_live_tup + n_dead_tup > 0 
          THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
          ELSE 0 
        END as bloat_ratio
      FROM pg_stat_user_tables
      WHERE schemaname NOT IN ('pg_catalog', 'pg_toast')
      ORDER BY bloat_ratio DESC
      LIMIT 10
    `);

    // Long running queries
    const longQueries = await pool.query(`
      SELECT 
        pid,
        usename,
        state,
        EXTRACT(EPOCH FROM now() - query_start)::integer || 's' as query_duration,
        query
      FROM pg_stat_activity
      WHERE state != 'idle'
      AND query NOT LIKE '%pg_stat_activity%'
      AND query_start < now() - interval '5 seconds'
      ORDER BY query_start ASC
    `);

    // Vacuum statistics
    const vacuumStats = await pool.query(`
      SELECT 
        schemaname,
        relname as table_name,
        last_vacuum,
        last_autovacuum,
        vacuum_count,
        autovacuum_count
      FROM pg_stat_user_tables
      WHERE schemaname NOT IN ('pg_catalog', 'pg_toast')
      ORDER BY last_autovacuum DESC NULLS LAST
      LIMIT 10
    `);

    res.render('health', {
      cacheStats: cacheStats.rows[0],
      txStats: txStats.rows[0],
      connStats,
      dbStats: dbStats.rows[0],
      lockStats: lockStats.rows,
      indexHealth: indexHealth.rows,
      tableBloat: tableBloat.rows,
      longQueries: longQueries.rows,
      vacuumStats: vacuumStats.rows,
      flash: req.flash()
    });
  } catch (error) {
    console.error('Error in health route:', error);
    req.flash('error', 'Failed to fetch database health metrics');
    res.render('health', { error: error.message, flash: req.flash() });
  }
});

// Databases route
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

// Global error handler - MOVED TO END
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// 404 handler - MOVED TO END
app.use((req, res) => {
  console.log('404 - Route not found:', req.method, req.url);
  res.status(404).json({ error: 'Not Found' });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`PostgreSQL Monitoring Tool running at http://0.0.0.0:${port}`);
});
