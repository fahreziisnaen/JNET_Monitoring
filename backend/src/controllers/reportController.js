const PDFDocument = require('pdfkit');
const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');
const { PassThrough } = require('stream');

const formatDataSize = (bytes) => {
    if (!+bytes || bytes < 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatPeakBandwidth = (bytesPerMinute) => {
    if (!+bytesPerMinute || bytesPerMinute < 0) return '0 Mbps';
    const mbps = (bytesPerMinute * 8) / 60 / 1000000;
    return `${mbps.toFixed(2)} Mbps`;
};

const formatAvgBandwidth = (avgBytes) => {
    if (!+avgBytes || avgBytes < 0) return '0 Mbps';
    const mbps = (avgBytes * 8) / 60 / 1000000;
    return `${mbps.toFixed(2)} Mbps`;
};

// Helper function to draw a box/card
function drawBox(doc, x, y, width, height, fillColor = '#f0f0f0', strokeColor = '#cccccc') {
    doc.rect(x, y, width, height)
       .fillAndStroke(fillColor, strokeColor);
}

// Helper function to draw table with borders and repeating headers
function drawTableWithHeader(doc, options) {
    const {
        startX = 50,
        startY,
        columnWidths,
        headers,
        rows,
        headerHeight = 30,
        rowHeight = 20,
        headerFillColor = '#4a5568',
        headerTextColor = '#ffffff',
        borderColor = '#e2e8f0',
        textColor = '#1a202c',
        fontSize = 10,
        headerFontSize = 11,
        pageBottom = 750
    } = options;
    
    // Adjust pageBottom to reserve space for footer (40px from bottom)
    const actualPageBottom = pageBottom - 40;
    
    let currentY = startY;
    let headerY = startY;
    let rowIndex = 0;
    const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
    
    // Calculate centered startX to ensure balanced margins
    // A4 width is approximately 595 points, with margins we have ~495 points available
    const pageWidth = doc.page.width || 595;
    const leftMargin = 50;
    const rightMargin = 50;
    const availableWidth = pageWidth - leftMargin - rightMargin;
    
    // If table is wider than available width, scale it down proportionally
    let actualTotalWidth = totalWidth;
    let actualStartX = startX;
    let scaleFactor = 1;
    
    if (totalWidth > availableWidth) {
        scaleFactor = availableWidth / totalWidth;
        actualTotalWidth = availableWidth;
        // Center the table
        actualStartX = leftMargin + (availableWidth - actualTotalWidth) / 2;
    } else {
        // Center the table if it's smaller than available width
        actualStartX = leftMargin + (availableWidth - totalWidth) / 2;
    }
    
    // Scale column widths if needed
    const actualColumnWidths = scaleFactor < 1 
        ? columnWidths.map(w => w * scaleFactor)
        : columnWidths;
    
    // Draw header function
    function drawHeader(y) {
        // Header background
        doc.rect(actualStartX, y, actualTotalWidth, headerHeight)
           .fill(headerFillColor);
        
        // Header text
        doc.fontSize(headerFontSize).fillColor(headerTextColor);
        let x = actualStartX + 5;
        headers.forEach((header, index) => {
            doc.text(header, x, y + (headerHeight / 2) - 7, {
                width: actualColumnWidths[index] - 10,
                align: 'left'
            });
            x += actualColumnWidths[index];
        });
        doc.fillColor(textColor);
        
        // Header borders - complete border around header
        doc.strokeColor(borderColor).lineWidth(1);
        // Top border
        doc.moveTo(actualStartX, y)
           .lineTo(actualStartX + actualTotalWidth, y)
           .stroke();
        // Bottom border
        doc.moveTo(actualStartX, y + headerHeight)
           .lineTo(actualStartX + actualTotalWidth, y + headerHeight)
           .stroke();
        // Left border
        doc.moveTo(actualStartX, y)
           .lineTo(actualStartX, y + headerHeight)
           .stroke();
        // Right border
        doc.moveTo(actualStartX + actualTotalWidth, y)
           .lineTo(actualStartX + actualTotalWidth, y + headerHeight)
           .stroke();
        // Vertical borders between header columns
        let headerX = actualStartX;
        for (let i = 0; i < actualColumnWidths.length - 1; i++) {
            headerX += actualColumnWidths[i];
            doc.moveTo(headerX, y)
               .lineTo(headerX, y + headerHeight)
               .stroke();
        }
    }
    
    // Draw initial header
    drawHeader(headerY);
    currentY += headerHeight;
    
    // Track page number for footer (passed from parent or default to 1)
    let pageNum = options.pageNum || 1;
    
    // Track the start Y of current page section for border drawing
    let pageStartY = headerY;
    
    // Draw rows
    rows.forEach((row) => {
        // Check if we need a new page (with space for header and footer)
        if (currentY + rowHeight > actualPageBottom) {
            // Draw left and right borders for current page section before adding new page
            doc.strokeColor(borderColor).lineWidth(1);
            doc.moveTo(actualStartX, pageStartY)
               .lineTo(actualStartX, currentY)
               .stroke();
            doc.moveTo(actualStartX + actualTotalWidth, pageStartY)
               .lineTo(actualStartX + actualTotalWidth, currentY)
               .stroke();
            
            // Add footer to current page before adding new page
            const footerText = `Dibuat pada: ${new Date().toLocaleString('id-ID')} | Halaman ${pageNum}`;
            doc.fontSize(8)
               .fillColor('#718096')
               .text(
                   footerText,
                   leftMargin,
                   actualPageBottom + 10,
                   { align: 'center', width: availableWidth }
               );
            
            doc.addPage();
            pageNum++;
            currentY = 50; // Top margin
            headerY = currentY;
            pageStartY = headerY; // Reset page start for new page
            // Draw header on new page
            drawHeader(headerY);
            currentY += headerHeight;
        }
        
        // Draw row background (alternating colors)
        const rowFillColor = rowIndex % 2 === 0 ? '#ffffff' : '#f7fafc';
        doc.rect(actualStartX, currentY, actualTotalWidth, rowHeight)
           .fill(rowFillColor);
        
        // Draw row text
        doc.fontSize(fontSize).fillColor(textColor);
        let x = actualStartX + 5;
        row.forEach((cell, cellIndex) => {
            doc.text(cell, x, currentY + (rowHeight / 2) - 6, {
                width: actualColumnWidths[cellIndex] - 10,
                align: 'left'
            });
            x += actualColumnWidths[cellIndex];
        });
        
        // Draw row borders
        doc.strokeColor(borderColor).lineWidth(0.5);
        // Left border for row
        doc.moveTo(actualStartX, currentY)
           .lineTo(actualStartX, currentY + rowHeight)
           .stroke();
        // Right border for row
        doc.moveTo(actualStartX + actualTotalWidth, currentY)
           .lineTo(actualStartX + actualTotalWidth, currentY + rowHeight)
           .stroke();
        // Vertical borders between columns
        let cellX = actualStartX;
        for (let i = 0; i < actualColumnWidths.length - 1; i++) {
            cellX += actualColumnWidths[i];
            doc.moveTo(cellX, currentY)
               .lineTo(cellX, currentY + rowHeight)
               .stroke();
        }
        // Bottom border for row
        doc.moveTo(actualStartX, currentY + rowHeight)
           .lineTo(actualStartX + actualTotalWidth, currentY + rowHeight)
           .stroke();
        
        currentY += rowHeight;
        rowIndex++;
    });
    
    // Draw outer border for the table - ensure left and right borders are continuous
    // Draw left and right borders for the last page section
    doc.strokeColor(borderColor).lineWidth(1);
    doc.moveTo(actualStartX, pageStartY)
       .lineTo(actualStartX, currentY)
       .stroke();
    doc.moveTo(actualStartX + actualTotalWidth, pageStartY)
       .lineTo(actualStartX + actualTotalWidth, currentY)
       .stroke();
    
    // Top border is already drawn in header
    // Bottom border is already drawn in last row
    
    // Return both currentY and updated pageNum
    return { currentY, pageNum };
}

// Helper function to add footer and new page
function addFooterAndNewPage(doc, pageNum) {
    const footerText = `Dibuat pada: ${new Date().toLocaleString('id-ID')} | Halaman ${pageNum}`;
    doc.fontSize(8)
       .fillColor('#718096')
       .text(
           footerText,
           50,
           750,
           { align: 'center', width: doc.page.width - 100 }
       );
    doc.addPage();
    return pageNum + 1;
}

// Helper function to draw info box
function drawInfoBox(doc, x, y, width, title, items) {
    const boxHeight = 30 + (items.length * 20);
    
    // Box background
    doc.rect(x, y, width, boxHeight)
       .fill('#f7fafc')
       .stroke('#e2e8f0');
    
    // Title
    doc.fontSize(12).fillColor('#2d3748').font('Helvetica-Bold');
    doc.text(title, x + 10, y + 10, { width: width - 20 });
    
    // Items
    doc.fontSize(10).fillColor('#4a5568').font('Helvetica');
    let itemY = y + 35;
    items.forEach(item => {
        doc.text(item, x + 10, itemY, { width: width - 20 });
        itemY += 18;
    });
    
    doc.font('Helvetica'); // Reset font
    return y + boxHeight;
}

exports.generateMonthlyReport = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { year, month, devices } = req.query;
    
    if (!year || !month) {
        return res.status(400).json({ message: 'Year dan month harus diisi.' });
    }
    
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ message: 'Year dan month tidak valid.' });
    }
    
    // Parse selected devices
    let selectedDevices = [];
    
    if (devices) {
        try {
            selectedDevices = JSON.parse(devices);
        } catch (e) {
            return res.status(400).json({ message: 'Format devices tidak valid.' });
        }
    }
    
    if (selectedDevices.length === 0) {
        return res.status(400).json({ message: 'Minimal satu MikroTik harus dipilih.' });
    }
    
    try {
        // Get workspace info
        const [workspaces] = await pool.query(
            'SELECT id, name, main_interface FROM workspaces WHERE id = ?',
            [workspaceId]
        );
        
        if (workspaces.length === 0) {
            return res.status(404).json({ message: 'Workspace tidak ditemukan.' });
        }
        
        const workspace = workspaces[0];
        
        // Validate workspace data
        if (!workspace || !workspace.name) {
            return res.status(400).json({ message: 'Workspace data tidak valid.' });
        }
        
        // Calculate date range for the month
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59);
        
        // Validate date range
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ message: 'Tanggal tidak valid.' });
        }
        
        // Get SLA data (downtime events) - with error handling
        let totalDowntimeSeconds = 0;
        let totalEvents = 0;
        let ongoingEvents = 0;
        
        try {
            const [downtimeStats] = await pool.query(
                `SELECT 
                    COUNT(*) as total_events,
                    SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds,
                    COUNT(CASE WHEN end_time IS NULL THEN 1 END) as ongoing_events
                 FROM downtime_events
                 WHERE workspace_id = ? 
                 AND DATE(start_time) >= ? AND DATE(start_time) <= ?`,
                [workspaceId, startDate, endDate]
            );
            
            totalDowntimeSeconds = downtimeStats[0]?.total_downtime_seconds || 0;
            totalEvents = downtimeStats[0]?.total_events || 0;
            ongoingEvents = downtimeStats[0]?.ongoing_events || 0;
        } catch (dbError) {
            console.error("[Report] Error fetching downtime stats:", dbError);
            // Continue with default values
        }
        
        // Get user statistics - with error handling
        let totalUsers = 0;
        let totalUserUsage = 0;
        
        try {
            const [pppoeStats] = await pool.query(
                `SELECT 
                    COUNT(DISTINCT pppoe_user) as total_users,
                    SUM(CASE WHEN DATE(usage_date) >= ? AND DATE(usage_date) <= ? THEN total_bytes ELSE 0 END) as total_usage
                 FROM pppoe_usage_logs
                 WHERE workspace_id = ? 
                 AND usage_date >= ? AND usage_date <= ?`,
                [startDate, endDate, workspaceId, startDate, endDate]
            );
            
            totalUsers = pppoeStats[0]?.total_users || 0;
            totalUserUsage = pppoeStats[0]?.total_usage || 0;
        } catch (dbError) {
            console.error("[Report] Error fetching PPPoE stats:", dbError);
            // Continue with default values
        }
        
        // Daily traffic data (empty for now, can be populated later if needed)
        const dailyTraffic = [];
        
        // Get device statistics (CPU & Memory) and client statistics per device
        const deviceStatsMap = new Map(); // deviceId -> { device_name, avg_cpu, avg_memory }
        const clientStatsPerDevice = new Map(); // deviceId -> [client stats]
        
        for (const deviceId of selectedDevices) {
            try {
                // Verify device belongs to workspace
                const [deviceInfo] = await pool.query(
                    'SELECT id, name FROM mikrotik_devices WHERE id = ? AND workspace_id = ?',
                    [deviceId, workspaceId]
                );
                
                if (deviceInfo.length === 0) {
                    console.log(`[Report] Device ${deviceId} not found in workspace ${workspaceId}`);
                    continue;
                }
                
                const deviceName = deviceInfo[0].name;
                
                // Get average CPU and Memory usage from resource_logs for this device in the selected month
                let avgCpu = null;
                let avgMemory = null;
                let logCount = 0;
                
                try {
                    const [resourceStats] = await pool.query(
                        `SELECT 
                            AVG(cpu_load) as avg_cpu_load,
                            AVG(memory_usage) as avg_memory_usage,
                            COUNT(*) as log_count
                         FROM resource_logs
                         WHERE workspace_id = ? AND device_id = ?
                         AND DATE(timestamp) >= ? AND DATE(timestamp) <= ?`,
                        [workspaceId, deviceId, startDate, endDate]
                    );
                    
                    avgCpu = resourceStats[0]?.avg_cpu_load ? Math.round(resourceStats[0].avg_cpu_load) : null;
                    avgMemory = resourceStats[0]?.avg_memory_usage ? Math.round(resourceStats[0].avg_memory_usage) : null;
                    logCount = resourceStats[0]?.log_count || 0;
                } catch (resourceError) {
                    console.error(`[Report] Error fetching resource stats for device ${deviceId}:`, resourceError);
                    // Continue with null values
                }
                
                deviceStatsMap.set(deviceId, {
                    device_name: deviceName,
                    avg_cpu: avgCpu,
                    avg_memory: avgMemory,
                    log_count: logCount
                });
                
                // Get all client statistics for this workspace (all PPPoE users)
                // Note: Since there's no direct link between PPPoE user and device,
                // we'll show all workspace clients for each device
                let clientStats = [];
                
                try {
                    const [clientUsage] = await pool.query(
                        `SELECT 
                            pppoe_user,
                            SUM(total_bytes) as total_usage
                         FROM pppoe_usage_logs
                         WHERE workspace_id = ?
                         AND usage_date >= ? AND usage_date <= ?
                         GROUP BY pppoe_user
                         ORDER BY total_usage DESC
                         LIMIT 1000`,
                        [workspaceId, startDate, endDate]
                    );
                    
                    // Process client stats with error handling
                    clientStats = await Promise.all(
                        clientUsage.map(async (client) => {
                            try {
                                const [downtimeData] = await pool.query(
                                    `SELECT 
                                        SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds,
                                        COUNT(*) as downtime_events
                                     FROM downtime_events
                                     WHERE workspace_id = ?
                                     AND pppoe_user = ?
                                     AND DATE(start_time) >= ? AND DATE(start_time) <= ?`,
                                    [workspaceId, client.pppoe_user, startDate, endDate]
                                );
                                
                                return {
                                    pppoe_user: client.pppoe_user,
                                    total_usage: client.total_usage || 0,
                                    total_downtime_seconds: downtimeData[0]?.total_downtime_seconds || 0,
                                    downtime_events: downtimeData[0]?.downtime_events || 0
                                };
                            } catch (clientError) {
                                console.error(`[Report] Error fetching downtime for client ${client.pppoe_user}:`, clientError);
                                // Return client with default downtime values
                                return {
                                    pppoe_user: client.pppoe_user,
                                    total_usage: client.total_usage || 0,
                                    total_downtime_seconds: 0,
                                    downtime_events: 0
                                };
                            }
                        })
                    );
                } catch (clientUsageError) {
                    console.error(`[Report] Error fetching client usage for device ${deviceId}:`, clientUsageError);
                    // Continue with empty client stats
                }
                
                clientStatsPerDevice.set(deviceId, clientStats);
            } catch (deviceError) {
                console.error(`[Report] Error processing device ${deviceId}:`, deviceError);
                // Continue to next device
                continue;
            }
        }
        
        // Validate that we have at least some data
        if (deviceStatsMap.size === 0) {
            return res.status(400).json({ message: 'Tidak ada device yang valid untuk dilaporkan.' });
        }
        
        // Generate PDF to buffer first (not directly to response)
        // This prevents "response already sent" errors if something fails during generation
        const pdfBuffer = [];
        const doc = new PDFDocument({ 
            margin: 50,
            size: 'A4'
        });
        
        // Create a stream to collect PDF data
        const stream = new PassThrough();
        
        // Collect PDF chunks
        stream.on('data', (chunk) => {
            pdfBuffer.push(chunk);
        });
        
        // Pipe PDF to stream (not directly to response)
        doc.pipe(stream);
        
        // Set response headers (before generating content)
        const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                           'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const monthName = monthNames[monthNum - 1];
        const filename = `Laporan-${monthName}-${yearNum}.pdf`;
        
        // Beautiful Header with background
        const headerHeight = 120;
        doc.rect(0, 0, doc.page.width, headerHeight)
           .fill('#2d3748');
        
        doc.fillColor('#ffffff')
           .fontSize(24)
           .font('Helvetica-Bold')
           .text('LAPORAN BULANAN', 50, 30, { align: 'center', width: doc.page.width - 100 });
        
        doc.fontSize(16)
           .font('Helvetica')
           .text('JNET MONITORING', 50, 60, { align: 'center', width: doc.page.width - 100 });
        
        doc.fontSize(12)
           .text(`Workspace: ${workspace.name}`, 50, 85, { align: 'center', width: doc.page.width - 100 });
        
        doc.fontSize(11)
           .text(`${monthName} ${yearNum}`, 50, 105, { align: 'center', width: doc.page.width - 100 });
        
        let currentY = headerHeight + 30;
        
        // Summary Section with Info Box
        
        // SLA Section with Info Box
        const totalDays = new Date(yearNum, monthNum, 0).getDate();
        const totalSecondsInMonth = totalDays * 24 * 60 * 60;
        const uptimeSeconds = totalSecondsInMonth - totalDowntimeSeconds;
        const slaPercentage = totalSecondsInMonth > 0 ? (uptimeSeconds / totalSecondsInMonth) * 100 : 100;
        
        const slaItems = [
            `SLA Percentage: ${slaPercentage.toFixed(2)}%`,
            `Total Downtime Events: ${totalEvents}`,
            `Total Downtime: ${formatDuration(totalDowntimeSeconds)}`
        ];
        if (ongoingEvents > 0) {
            slaItems.push(`Downtime Berlangsung: ${ongoingEvents} (Perhatian!)`);
        }
        currentY = drawInfoBox(doc, 50, currentY, doc.page.width - 100, 'SLA & DOWNTIME', slaItems);
        currentY += 20;
        
        // Track page number for footer
        let pageNum = 1;
        
        // MikroTik Device Statistics Section (CPU & Memory) and Client Statistics
        if (deviceStatsMap.size > 0) {
            // Render each device
            for (const [deviceId, deviceStats] of deviceStatsMap) {
                // Check if we need a new page
                if (currentY > 600) {
                    pageNum = addFooterAndNewPage(doc, pageNum);
                    currentY = 50;
                }
                
                doc.fontSize(16)
                   .fillColor('#2d3748')
                   .font('Helvetica-Bold')
                   .text(`DEVICE: ${deviceStats.device_name}`, 50, currentY);
                currentY += 25;
                
                // Device Statistics (CPU & Memory)
                const deviceStatsItems = [];
                if (deviceStats.avg_cpu !== null) {
                    deviceStatsItems.push(`Rata-rata CPU Load: ${deviceStats.avg_cpu}%`);
                } else {
                    deviceStatsItems.push(`Rata-rata CPU Load: N/A (tidak ada data)`);
                }
                if (deviceStats.avg_memory !== null) {
                    deviceStatsItems.push(`Rata-rata Memory Usage: ${formatDataSize(deviceStats.avg_memory)}`);
                } else {
                    deviceStatsItems.push(`Rata-rata Memory Usage: N/A (tidak ada data)`);
                }
                deviceStatsItems.push(`Total Log Entries: ${deviceStats.log_count}`);
                
                currentY = drawInfoBox(doc, 50, currentY, doc.page.width - 100, 'DEVICE STATISTICS', deviceStatsItems);
                currentY += 20;
                
                // Client Statistics for this device
                const deviceClientStats = clientStatsPerDevice.get(deviceId);
                if (deviceClientStats && deviceClientStats.length > 0) {
                    // Check if we need a new page
                    if (currentY > 650) {
                        pageNum = addFooterAndNewPage(doc, pageNum);
                        currentY = 50;
                    }
                    
                    doc.fontSize(14)
                       .fillColor('#4a5568')
                       .font('Helvetica-Bold')
                       .text(`STATISTIK PER CLIENT (PPPoE SECRET) - ${deviceStats.device_name}`, 50, currentY);
                    currentY += 20;
                    
                    // Add Total Pengguna above the table
                    doc.fontSize(12)
                       .fillColor('#4a5568')
                       .font('Helvetica')
                       .text(`Total Pengguna: ${deviceClientStats.length}`, 50, currentY);
                    currentY += 20;
                    
                    const clientRows = deviceClientStats.map(client => {
                        const clientName = (client.pppoe_user || 'N/A').length > 25 
                            ? (client.pppoe_user || 'N/A').substring(0, 22) + '...'
                            : (client.pppoe_user || 'N/A');
                        return [
                            clientName,
                            formatDataSize(client.total_usage || 0),
                            formatDuration(client.total_downtime_seconds || 0),
                            (client.downtime_events || 0).toString()
                        ];
                    });
                    
                    const tableResult2 = drawTableWithHeader(doc, {
                        startY: currentY,
                        columnWidths: [180, 120, 150, 100],
                        headers: ['Client', 'Total Usage', 'Total Downtime', 'Downtime Events'],
                        rows: clientRows,
                        fontSize: 9,
                        headerFontSize: 10,
                        pageBottom: 750,
                        pageNum: pageNum
                    });
                    currentY = tableResult2.currentY;
                    pageNum = tableResult2.pageNum;
                    currentY += 20; // Space before next device
                } else {
                    // No clients found
                    doc.fontSize(12)
                       .fillColor('#718096')
                       .font('Helvetica')
                       .text('Tidak ada data client untuk device ini.', 50, currentY);
                    currentY += 20;
                }
            }
        }
        
        // Old Client Statistics Section (removed - now per device)
        // This section is kept for backward compatibility but should not be reached
        if (false && clientStats && clientStats.length > 0) {
            if (currentY > 650) {
                pageNum = addFooterAndNewPage(doc, pageNum);
                currentY = 50;
            }
            
            doc.fontSize(16)
               .fillColor('#2d3748')
               .font('Helvetica-Bold')
               .text('STATISTIK PER CLIENT (PPPoE SECRET)', 50, currentY);
            currentY += 25;
            
            // Add Total Pengguna above the table
            doc.fontSize(12)
               .fillColor('#4a5568')
               .font('Helvetica')
               .text(`Total Pengguna: ${totalUsers}`, 50, currentY);
            currentY += 20;
            
            const clientRows = clientStats.map(client => {
                const clientName = (client.pppoe_user || 'N/A').length > 25 
                    ? (client.pppoe_user || 'N/A').substring(0, 22) + '...'
                    : (client.pppoe_user || 'N/A');
                return [
                    clientName,
                    formatDataSize(client.total_usage || 0),
                    formatDuration(client.total_downtime_seconds || 0),
                    (client.downtime_events || 0).toString()
                ];
            });
            
            const tableResult2 = drawTableWithHeader(doc, {
                startY: currentY,
                columnWidths: [180, 120, 150, 100],
                headers: ['Client', 'Total Usage', 'Total Downtime', 'Downtime Events'],
                rows: clientRows,
                fontSize: 9,
                headerFontSize: 10,
                pageBottom: 750,
                pageNum: pageNum
            });
            currentY = tableResult2.currentY;
            pageNum = tableResult2.pageNum;
            currentY += 20;
        }
        
        // Daily Traffic Section
        if (dailyTraffic && dailyTraffic.length > 0) {
            if (currentY > 650) {
                pageNum = addFooterAndNewPage(doc, pageNum);
                currentY = 50;
            }
            
            doc.fontSize(16)
               .fillColor('#2d3748')
               .font('Helvetica-Bold')
               .text('RINGKASAN TRAFIK HARIAN', 50, currentY);
            currentY += 25;
            
            const dailyRows = dailyTraffic.map(day => [
                new Date(day.date).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                formatDataSize(day.daily_usage || 0),
                Math.round(day.avg_users || 0).toString()
            ]);
            
            const tableResult3 = drawTableWithHeader(doc, {
                startY: currentY,
                columnWidths: [120, 150, 100],
                headers: ['Tanggal', 'Usage', 'Avg Users'],
                rows: dailyRows,
                fontSize: 10,
                headerFontSize: 11,
                pageBottom: 750,
                pageNum: pageNum
            });
            currentY = tableResult3.currentY;
            pageNum = tableResult3.pageNum;
        }
        
        // Add footer to current (last) page
        // Ensure footer is placed correctly within page bounds
        let footerY = Math.min(currentY + 20, 750); // Add space after content, max at 750
        
        const footerText = `Dibuat pada: ${new Date().toLocaleString('id-ID')} | Halaman ${pageNum}`;
        doc.fontSize(8)
           .fillColor('#718096')
           .text(
               footerText,
               50,
               footerY,
               { align: 'center', width: doc.page.width - 100 }
           );
        
        // Finalize PDF
        doc.end();
        
        // Wait for PDF to finish generating
        await new Promise((resolve, reject) => {
            stream.on('end', () => {
                resolve();
            });
            stream.on('error', (err) => {
                reject(err);
            });
            doc.on('error', (err) => {
                reject(err);
            });
        });
        
        // Now that PDF is complete, send response
        const finalBuffer = Buffer.concat(pdfBuffer);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', finalBuffer.length);
        
        res.send(finalBuffer);
        
    } catch (error) {
        console.error("GENERATE MONTHLY REPORT ERROR:", error);
        console.error("Error stack:", error.stack);
        
        // Only send error response if response hasn't been sent yet
        if (!res.headersSent) {
            res.status(500).json({ 
                message: 'Gagal membuat laporan PDF.', 
                error: process.env.NODE_ENV === 'development' ? error.message : 'Terjadi kesalahan saat membuat laporan. Silakan coba lagi atau hubungi administrator.'
            });
        } else {
            // If response already sent, just log the error
            console.error("Response already sent, cannot send error response");
        }
    }
};

function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds < 0) {
        return '0 detik';
    }
    
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days} hari`);
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} detik`);
    
    return parts.join(' ');
}
