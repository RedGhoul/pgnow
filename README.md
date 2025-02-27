# PGNow - PostgreSQL Monitoring Tool

PGNow is a comprehensive, real-time PostgreSQL database monitoring tool that provides a centralized dashboard for tracking database health, performance, and resource usage.

![PGNow Dashboard](https://via.placeholder.com/800x450.png?text=PGNow+Dashboard)

## Features

- **Database Status**: View PostgreSQL version, uptime, and current status
- **Connections**: Monitor active, idle, and total connections with usage trends
- **Performance**: Track queries per second, transaction metrics, and cache hit ratio
- **Storage**: View database size and largest tables
- **Slow Queries**: Identify and analyze the slowest queries
- **Index Usage**: Monitor index usage statistics and identify optimization opportunities
- **Real-time Updates**: Automatic refresh of metrics for up-to-date monitoring

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- PostgreSQL (v10 or higher)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/pgnow.git
   cd pgnow
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your PostgreSQL connection details:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=your_database_name
   DB_USER=your_username
   DB_PASSWORD=your_password
   PORT=3000
   SESSION_SECRET=your_secret_key
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Enabling Slow Query Monitoring

To enable the slow query monitoring feature, you need to enable the `pg_stat_statements` extension in PostgreSQL:

1. Add the following to your `postgresql.conf` file:
   ```
   shared_preload_libraries = 'pg_stat_statements'
   pg_stat_statements.track = all
   ```

2. Restart PostgreSQL

3. Connect to your database and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```

## Development

To run the application in development mode with automatic restarts:

```
npm run dev
```

## License

This project is licensed under the ISC License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 