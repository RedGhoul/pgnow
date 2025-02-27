# PGNow - PostgreSQL Monitoring Tool

PGNow is a comprehensive, real-time PostgreSQL database monitoring tool that provides a centralized dashboard for tracking database health, performance, and resource usage.

## Dashboard Screenshots

### Main Dashboard Overview
![Main Dashboard](Screenshot%202025-02-27%20163115.png)
*Core metrics showing database version, uptime, connections, and query performance trends*

### System Health and Database Sizes
![System Health](Screenshot%202025-02-27%20163139.png)
*System health metrics including CPU usage, cache hit ratio, and database size distribution*

### Transaction Statistics and Size Distribution
![Transaction Stats](Screenshot%202025-02-27%20163155.png)
*Detailed transaction statistics and visual database size distribution*

### Database Health and Performance Metrics
![Database Health](Screenshot%202025-02-27%20163210.png)
*Comprehensive health overview including cache performance, locks, and query monitoring*

## Features

### Core Monitoring
- **Database Status**: Real-time monitoring of database status, uptime tracking, and PostgreSQL version information
- **Connection Management**: 
  - Active and idle connection monitoring
  - Maximum connection limit tracking
  - Visual connection usage trends
  - Connection utilization alerts

### Performance Metrics
- **Query Performance**:
  - Queries per second tracking
  - Average query execution time
  - Query success rate monitoring
- **Cache Performance**:
  - Buffer cache hit ratio
  - Block read/write statistics
  - Cache efficiency metrics

### Storage & Resources
- **Database Size Analytics**:
  - Total database size monitoring
  - Top 5 largest tables tracking
  - Per-database size distribution
- **Resource Monitoring**:
  - Basic connection utilization metrics
  - Transaction success rates
  - Block read/write operations

### Transaction & Lock Management
- **Transaction Metrics**:
  - Transaction rate monitoring
  - Commit/rollback statistics
  - Active lock tracking
- **Index Management**:
  - Index usage statistics
  - Unused index detection
  - Index optimization suggestions

### Real-time Updates
- Automatic metric refresh every 5-30 seconds
- Live status monitoring
- Dynamic performance graphs

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

## Development

To run the application in development mode with automatic restarts:

```
npm run dev
```

## Known Limitations

- CPU and memory usage monitoring is limited to connection-based metrics
- Network I/O monitoring is not currently implemented
- Detailed storage growth trends are not tracked historically
- Alert system and customizable thresholds are not implemented
- Slow query analysis requires manual configuration
- Deadlock detection is not implemented

## License

This project is licensed under the ISC License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 