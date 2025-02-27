require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const moment = require('moment');
const session = require('express-session');
const flash = require('connect-flash');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour
}));
app.use(flash());

// Make moment available in all views
app.locals.moment = moment;

// Routes
app.get('/', async (req, res) => {
  try {
    // Get database status
    const dbStatus = await pool.query('SELECT version(), current_timestamp - pg_postmaster_start_time() as uptime');
    
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
    
    // Get database size
    const dbSize = await pool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    
    // Get top 5 largest tables
    const largestTables = await pool.query(`
      SELECT 
        table_name, 
        pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC
      LIMIT 5
    `);
    
    // Get slow queries
    const slowQueries = await pool.query(`
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        rows
      FROM pg_stat_statements
      ORDER BY mean_time DESC
      LIMIT 5
    `).catch(() => ({ rows: [] })); // Handle if pg_stat_statements is not enabled
    
    // Get index usage
    const indexUsage = await pool.query(`
      SELECT 
        relname as table_name,
        idx_scan as index_scans,
        seq_scan as sequential_scans,
        CASE WHEN idx_scan + seq_scan = 0 THEN 0
             ELSE 100 * idx_scan / (idx_scan + seq_scan)
        END as index_usage_percent
      FROM pg_stat_user_tables
      ORDER BY index_usage_percent DESC
      LIMIT 10
    `);
    
    // Render the dashboard with all collected data
    res.render('dashboard', {
      dbStatus: dbStatus.rows[0],
      connectionInfo: connectionInfo.rows[0],
      maxConnections: maxConnections.rows[0].max_connections,
      dbSize: dbSize.rows[0].size,
      largestTables: largestTables.rows,
      slowQueries: slowQueries.rows || [],
      indexUsage: indexUsage.rows,
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

// Start the server
app.listen(port, () => {
  console.log(`PostgreSQL Monitoring Tool running at http://localhost:${port}`);
});
