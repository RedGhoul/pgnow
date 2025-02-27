document.addEventListener('DOMContentLoaded', function() {
    // Check database status every 10 seconds
    setInterval(checkDatabaseStatus, 10000);
    
    // Update performance metrics every 5 seconds
    setInterval(updatePerformanceMetrics, 5000);
    
    // Initial calls
    checkDatabaseStatus();
    updatePerformanceMetrics();
});

/**
 * Check database status and update the status indicator
 */
function checkDatabaseStatus() {
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            const statusIndicator = document.getElementById('status-indicator');
            const statusText = document.getElementById('status-text');
            
            if (data.status === 'up') {
                statusIndicator.className = 'status-indicator status-up';
                statusText.textContent = 'Database Up';
            } else {
                statusIndicator.className = 'status-indicator status-down';
                statusText.textContent = 'Database Down';
                
                // Show error message if available
                if (data.error) {
                    console.error('Database error:', data.error);
                }
            }
        })
        .catch(error => {
            console.error('Error checking database status:', error);
            
            // Update UI to show connection error
            const statusIndicator = document.getElementById('status-indicator');
            const statusText = document.getElementById('status-text');
            
            statusIndicator.className = 'status-indicator status-down';
            statusText.textContent = 'Connection Error';
        });
}

/**
 * Update performance metrics in the dashboard
 */
function updatePerformanceMetrics() {
    fetch('/api/performance')
        .then(response => response.json())
        .then(data => {
            const performanceMetricsDiv = document.getElementById('performance-metrics');
            
            if (data.error) {
                performanceMetricsDiv.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                return;
            }
            
            // Format the performance metrics
            let html = `
                <div class="d-flex justify-content-between mb-2">
                    <span>Commits:</span>
                    <strong>${formatNumber(data.commits)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Rollbacks:</span>
                    <strong>${formatNumber(data.rollbacks)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Blocks Read:</span>
                    <strong>${formatNumber(data.blocks_read)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Blocks Hit:</span>
                    <strong>${formatNumber(data.blocks_hit)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Rows Returned:</span>
                    <strong>${formatNumber(data.rows_returned)}</strong>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Rows Fetched:</span>
                    <strong>${formatNumber(data.rows_fetched)}</strong>
                </div>
            `;
            
            // Calculate cache hit ratio
            if (data.blocks_read > 0 || data.blocks_hit > 0) {
                const cacheHitRatio = (data.blocks_hit / (data.blocks_hit + data.blocks_read) * 100).toFixed(2);
                
                html += `
                    <h6 class="mt-3">Cache Hit Ratio</h6>
                    <div class="progress">
                        <div class="progress-bar ${cacheHitRatio < 70 ? 'bg-danger' : (cacheHitRatio < 90 ? 'bg-warning' : 'bg-success')}" 
                            role="progressbar" 
                            style="width: ${cacheHitRatio}%;" 
                            aria-valuenow="${cacheHitRatio}" 
                            aria-valuemin="0" 
                            aria-valuemax="100">
                            ${cacheHitRatio}%
                        </div>
                    </div>
                `;
            }
            
            performanceMetricsDiv.innerHTML = html;
        })
        .catch(error => {
            console.error('Error updating performance metrics:', error);
            document.getElementById('performance-metrics').innerHTML = `
                <div class="alert alert-danger">
                    Failed to fetch performance metrics
                </div>
            `;
        });
}

/**
 * Format numbers with commas for better readability
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
} 