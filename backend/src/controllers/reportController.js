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

const formatRupiah = (nominal) => {
    if (nominal === null || nominal === undefined || isNaN(+nominal)) return '-';
    return 'Rp ' + Number(nominal).toLocaleString('id-ID');
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
    const user = req.user;
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
        // Get all authorized workspaces
        const isSuper = user.is_super_admin === 1 || user.is_super_admin === true;
        let authorizedIds = [];

        if (isSuper) {
            // Superadmin can access all workspaces
            const [allWorkspaces] = await pool.query('SELECT id FROM workspaces');
            authorizedIds = allWorkspaces.map(w => w.id);
        } else {
            // Get all authorized workspaces for NOC/Regular user
            const [permWorkspaces] = await pool.query(
                'SELECT workspace_id FROM noc_permissions WHERE user_id = ?',
                [user.id]
            );
            authorizedIds = [user.workspace_id, ...permWorkspaces.map(p => p.workspace_id)].filter(id => id !== null);
        }

        // Get workspace info for the selected devices
        const usedWorkspaceIds = new Set();
        const verifiedDeviceInfos = [];
        
        for (const deviceId of selectedDevices) {
            const [deviceInfo] = await pool.query(
                'SELECT id, name, workspace_id FROM mikrotik_devices WHERE id = ? AND workspace_id IN (?)',
                [deviceId, authorizedIds]
            );

            if (deviceInfo.length > 0) {
                verifiedDeviceInfos.push(deviceInfo[0]);
                usedWorkspaceIds.add(deviceInfo[0].workspace_id);
            }
        }

        if (verifiedDeviceInfos.length === 0) {
            return res.status(400).json({ message: 'Tidak ada device yang valid untuk dilaporkan.' });
        }

        // Determine workspace name for header
        let workspaceName = '';
        if (usedWorkspaceIds.size === 1) {
            const [wsInfo] = await pool.query(
                'SELECT name FROM workspaces WHERE id = ?',
                [Array.from(usedWorkspaceIds)[0]]
            );
            workspaceName = wsInfo[0]?.name || 'Unknown Workspace';
        } else {
            workspaceName = 'Multiple Workspaces';
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
                 WHERE workspace_id IN (?) AND device_id IN (?)
                 AND DATE(start_time) >= ? AND DATE(start_time) <= ?`,
                [authorizedIds, selectedDevices, startDate, endDate]
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
                    SUM(total_bytes) as total_usage
                 FROM pppoe_usage_logs
                 WHERE workspace_id IN (?) 
                 AND device_id IN (?)
                 AND usage_date >= ? AND usage_date <= ?`,
                [authorizedIds, selectedDevices, startDate, endDate]
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
        const deviceStatsMap = new Map(); // deviceId -> { device_name, avg_cpu, avg_memory, usage, users, SLA }
        const clientStatsPerDevice = new Map(); // deviceId -> [client stats]

        // Lookup nominal tagihan (billing invoice) per PPPoE secret untuk bulan yang dipilih,
        // di-cache per workspace agar tidak query berulang jika satu workspace punya banyak device.
        const billingBySecretCache = new Map(); // workspaceId -> Map(secretName -> amount)

        async function getBillingBySecret(workspaceId) {
            if (billingBySecretCache.has(workspaceId)) return billingBySecretCache.get(workspaceId);
            const map = new Map();
            try {
                const [invRows] = await pool.query(
                    `SELECT c.pppoe_secret_name, i.amount
                     FROM billing_invoices i
                     JOIN billing_customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
                     WHERE i.workspace_id = ? AND i.period_year = ? AND i.period_month = ?
                       AND c.pppoe_secret_name IS NOT NULL AND c.pppoe_secret_name <> ''
                       AND i.status <> 'void'`,
                    [workspaceId, yearNum, monthNum]
                );
                invRows.forEach(row => {
                    if (!map.has(row.pppoe_secret_name)) {
                        map.set(row.pppoe_secret_name, row.amount);
                    }
                });
            } catch (billingError) {
                console.error(`[Report] Error fetching billing invoices for workspace ${workspaceId}:`, billingError.message);
            }
            billingBySecretCache.set(workspaceId, map);
            return map;
        }

        for (const devInfo of verifiedDeviceInfos) {
            const deviceId = devInfo.id;
            const deviceName = devInfo.name;
            const deviceWorkspaceId = devInfo.workspace_id;

            try {
                // 1. Get average CPU and Memory usage from resource_logs for this device in the selected month
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
                        [deviceWorkspaceId, deviceId, startDate, endDate]
                    );

                    avgCpu = resourceStats[0]?.avg_cpu_load ? Math.round(resourceStats[0].avg_cpu_load) : null;
                    avgMemory = resourceStats[0]?.avg_memory_usage ? Math.round(resourceStats[0].avg_memory_usage) : null;
                    logCount = resourceStats[0]?.log_count || 0;
                } catch (resourceError) {
                    console.error(`[Report] Error fetching resource stats for device ${deviceId}:`, resourceError);
                }

                // 2. Get SLA data for this specific device
                let deviceDowntimeSeconds = 0;
                let deviceEvents = 0;
                let deviceOngoingEvents = 0;
                try {
                    const [downtimeStats] = await pool.query(
                        `SELECT 
                            COUNT(*) as total_events,
                            SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds,
                            COUNT(CASE WHEN end_time IS NULL THEN 1 END) as ongoing_events
                         FROM downtime_events
                         WHERE workspace_id = ? AND device_id = ?
                         AND DATE(start_time) >= ? AND DATE(start_time) <= ?`,
                        [deviceWorkspaceId, deviceId, startDate, endDate]
                    );
                    deviceDowntimeSeconds = downtimeStats[0]?.total_downtime_seconds || 0;
                    deviceEvents = downtimeStats[0]?.total_events || 0;
                    deviceOngoingEvents = downtimeStats[0]?.ongoing_events || 0;
                } catch (e) {
                    console.error(`[Report] Error fetching device downtime:`, e);
                }

                // 3. Get Usage for this specific device
                let deviceUsage = 0;
                let deviceUsers = 0;
                try {
                    const [usageStats] = await pool.query(
                        `SELECT 
                            COUNT(DISTINCT pppoe_user) as total_users,
                            SUM(total_bytes) as total_usage
                         FROM pppoe_usage_logs
                         WHERE workspace_id = ? AND device_id = ?
                         AND usage_date >= ? AND usage_date <= ?`,
                        [deviceWorkspaceId, deviceId, startDate, endDate]
                    );
                    deviceUsage = usageStats[0]?.total_usage || 0;
                    deviceUsers = usageStats[0]?.total_users || 0;
                } catch (e) {
                    console.error(`[Report] Error fetching device usage:`, e);
                }

                deviceStatsMap.set(deviceId, {
                    device_name: deviceName,
                    avg_cpu: avgCpu,
                    avg_memory: avgMemory,
                    log_count: logCount,
                    usage: deviceUsage,
                    users: deviceUsers,
                    downtime_seconds: deviceDowntimeSeconds,
                    events: deviceEvents,
                    ongoing_events: deviceOngoingEvents
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
                         WHERE workspace_id = ? AND device_id = ?
                         AND usage_date >= ? AND usage_date <= ?
                         GROUP BY pppoe_user
                         ORDER BY total_usage DESC
                         LIMIT 1000`,
                        [deviceWorkspaceId, deviceId, startDate, endDate]
                    );

                    // Process client stats with error handling
                    const invoiceBySecret = await getBillingBySecret(deviceWorkspaceId);

                    clientStats = await Promise.all(
                        clientUsage.map(async (client) => {
                            try {
                                const [downtimeData] = await pool.query(
                                    `SELECT 
                                        SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds,
                                        COUNT(*) as downtime_events
                                     FROM downtime_events
                                     WHERE workspace_id = ? AND device_id = ? AND pppoe_user = ?
                                     AND start_time >= ? AND start_time <= ?`,
                                    [deviceWorkspaceId, deviceId, client.pppoe_user, startDate, endDate]
                                );

                                return {
                                    pppoe_user: client.pppoe_user,
                                    total_usage: client.total_usage || 0,
                                    total_downtime_seconds: downtimeData[0]?.total_downtime_seconds || 0,
                                    downtime_events: downtimeData[0]?.downtime_events || 0,
                                    invoice_amount: invoiceBySecret.get(client.pppoe_user) ?? null
                                };
                            } catch (clientError) {
                                console.error(`[Report] Error fetching downtime for client ${client.pppoe_user}:`, clientError);
                                // Return client with default downtime values
                                return {
                                    pppoe_user: client.pppoe_user,
                                    total_usage: client.total_usage || 0,
                                    total_downtime_seconds: 0,
                                    downtime_events: 0,
                                    invoice_amount: invoiceBySecret.get(client.pppoe_user) ?? null
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

        const totalDays = new Date(yearNum, monthNum, 0).getDate();
        const totalSecondsInMonth = totalDays * 24 * 60 * 60;

        // 1. Draw Cover Page
        drawCoverPage(doc, monthName, yearNum, workspaceName);

        // Track page number for footer
        let pageNum = 1;
        let currentY = 50; // Will be reset for each device page

        // MikroTik Device Statistics Section (CPU & Memory) and Client Statistics
        if (deviceStatsMap.size > 0) {
            // Render each device
            for (const [deviceId, deviceStats] of deviceStatsMap) {
                // Always start each device on a new page to treat it like a sub-report
                pageNum = addFooterAndNewPage(doc, pageNum);
                currentY = 50;

                doc.fontSize(18)
                    .fillColor('#2d3748')
                    .font('Helvetica-Bold')
                    .text(`DETAIL PERANGKAT: ${deviceStats.device_name}`, 50, currentY);
                currentY += 30;

                // Device Summary & Statistics
                const deviceSummaryItems = [
                    `Total Data Terpakai: ${formatDataSize(deviceStats.usage)}`,
                    `Total Pengguna Aktif: ${deviceStats.users}`
                ];

                const devUptimeSeconds = totalSecondsInMonth - deviceStats.downtime_seconds;
                const devSlaPercentage = totalSecondsInMonth > 0 ? (devUptimeSeconds / totalSecondsInMonth) * 100 : 100;

                deviceSummaryItems.push(`SLA Percentage: ${devSlaPercentage.toFixed(2)}%`);
                deviceSummaryItems.push(`Total Downtime: ${formatDuration(deviceStats.downtime_seconds)}`);
                if (deviceStats.ongoing_events > 0) {
                    deviceSummaryItems.push(`Downtime Berlangsung: ${deviceStats.ongoing_events} (Perhatian!)`);
                }

                if (deviceStats.avg_cpu !== null) {
                    deviceSummaryItems.push(`Rata-rata CPU Load: ${deviceStats.avg_cpu}%`);
                }
                if (deviceStats.avg_memory !== null) {
                    deviceSummaryItems.push(`Rata-rata Memory Usage: ${formatDataSize(deviceStats.avg_memory)}`);
                }

                currentY = drawInfoBox(doc, 50, currentY, doc.page.width - 100, 'DEVICE SUMMARY & STATISTICS', deviceSummaryItems);
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
                        const clientName = (client.pppoe_user || 'N/A').length > 22
                            ? (client.pppoe_user || 'N/A').substring(0, 19) + '...'
                            : (client.pppoe_user || 'N/A');
                        return [
                            clientName,
                            formatDataSize(client.total_usage || 0),
                            formatDuration(client.total_downtime_seconds || 0),
                            (client.downtime_events || 0).toString(),
                            formatRupiah(client.invoice_amount)
                        ];
                    });

                    const tableResult2 = drawTableWithHeader(doc, {
                        startY: currentY,
                        columnWidths: [112, 65, 140, 88, 90],
                        headers: ['Client', 'Total Usage', 'Total Downtime', 'Downtime Events', 'Nominal Tagihan'],
                        columnAligns: ['left', 'right', 'left', 'right', 'right'],
                        rows: clientRows,
                        fontSize: 9,
                        headerFontSize: 9,
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

function drawCoverPage(doc, monthName, yearNum, workspaceName) {
    const width = doc.page.width;
    const height = doc.page.height;

    // Background Shapes
    // Top right shape
    doc.save();
    doc.translate(width - 100, -120);
    doc.rotate(25);
    doc.rect(0, 0, 500, 500).fill('#0a2f73');
    doc.restore();

    // Middle right shape
    doc.save();
    doc.translate(width - 80, 290);
    doc.rotate(10);
    doc.rect(0, 0, 420, 650).fillOpacity(0.95).fill('#2196f3');
    doc.restore();

    // Bottom left shape
    doc.save();
    doc.translate(-120, height - 320);
    doc.rotate(20);
    doc.rect(0, 0, 500, 500).fill('#001f4d');
    doc.restore();

    // Circles
    doc.fillOpacity(0.12).fillColor('white');
    doc.circle(width - 180, 120, 80).fill();
    doc.circle(120, height - 260, 45).fill();

    // Reset Opacity
    doc.fillOpacity(1);

    // Logo
    doc.fillColor('#0d47a1')
       .fontSize(58)
       .font('Helvetica-Bold')
       .text('JNET', 70, 70);
    doc.fillColor('#666')
       .fontSize(14)
       .font('Helvetica')
       .text('CONNECTING POSSIBILITIES', 70, 125, { characterSpacing: 2 });

    // Main Title
    doc.fillColor('#052a68')
       .fontSize(76)
       .font('Helvetica-Bold')
       .text('LAPORAN', 70, 280);
    doc.fillColor('#2196f3')
       .fontSize(64)
       .text('BULANAN', 70, 350);

    // Line
    doc.rect(70, 430, 90, 6).fill('#2196f3');

    // Subtitle
    doc.fillColor('#16345d')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('JNET MONITORING', 70, 460);

    // Description
    doc.fillColor('#666')
       .fontSize(18)
       .font('Helvetica')
       .text('Monitoring performa jaringan, stabilitas koneksi, dan kualitas layanan secara berkala untuk memastikan operasional berjalan optimal.', 70, 510, { width: 400, lineGap: 5 });

    // Icon Boxes
    const iconY = height - 340;
    const icons = [
        { label: 'MONITORING', color: '#0d47a1' },
        { label: 'RELIABILITY', color: '#1a73e8' },
        { label: 'PERFORMANCE', color: '#052a68' }
    ];

    icons.forEach((item, index) => {
        const x = 70 + (index * 150);
        doc.rect(x, iconY, 120, 120).fill('white');
        
        // Simple shape as icon
        doc.fillColor(item.color).circle(x + 60, iconY + 45, 25).fill();
        doc.fillColor('white').circle(x + 60, iconY + 45, 12).fill();
        
        doc.fillColor('#0d47a1')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(item.label, x, iconY + 85, { width: 120, align: 'center' });
    });

    // Footer Info
    doc.fillColor('#0d47a1')
       .fontSize(20)
       .font('Helvetica-Bold')
       .text(`${monthName.toUpperCase()} / ${yearNum}`, 70, height - 150);
    doc.moveTo(70, height - 120).lineTo(330, height - 120).dash(5, { space: 2 }).stroke('#999');

    // Vertical Text
    doc.save();
    doc.translate(width - 30, height / 2);
    doc.rotate(-90);
    doc.fillColor('white').fillOpacity(0.8).fontSize(16).font('Helvetica-Bold').text('NETWORK PERFORMANCE REPORT', -200, 0, { characterSpacing: 5, width: 400, align: 'center' });
    doc.restore();
}

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

function drawInfoBox(doc, x, y, width, title, items) {
    const padding = 15;
    const lineHeight = 18;
    const boxHeight = (items.length * lineHeight) + 40;

    // Box background
    doc.fillColor('#f8fafc').rect(x, y, width, boxHeight).fill();
    // Box border
    doc.strokeColor('#e2e8f0').rect(x, y, width, boxHeight).stroke();

    // Title
    doc.fillColor('#475569').fontSize(10).font('Helvetica-Bold').text(title, x + padding, y + 10);

    // Items
    doc.fillColor('#1e293b').fontSize(11).font('Helvetica');
    items.forEach((item, index) => {
        doc.text(item, x + padding, y + 30 + (index * lineHeight));
    });

    return y + boxHeight;
}

function addFooterAndNewPage(doc, pageNum) {
    const footerText = `Dibuat pada: ${new Date().toLocaleString('id-ID')} | Halaman ${pageNum}`;
    doc.fontSize(8).fillColor('#718096').text(footerText, 50, 750, { align: 'center', width: doc.page.width - 100 });
    doc.addPage();
    return pageNum + 1;
}

function drawTableWithHeader(doc, options) {
    const {
        startY,
        columnWidths,
        headers,
        rows,
        fontSize = 9,
        headerFontSize = 10,
        pageBottom = 750,
        columnAligns = null,
        cellPadding = 5,
        minRowHeight = 20,
        minHeaderHeight = 25
    } = options;
    let { pageNum } = options;
    let currentY = startY;

    // Ukuran halaman & margin agar tabel selalu muat dalam satu halaman
    const pageWidth = doc.page.width || 595;
    const leftMargin = 50;
    const rightMargin = 50;
    const availableWidth = pageWidth - leftMargin - rightMargin;

    // Skala proporsional bila total kolom melebihi lebar yang tersedia, lalu ratakan
    const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
    const scaleFactor = totalWidth > availableWidth ? availableWidth / totalWidth : 1;
    const widths = columnWidths.map(w => w * scaleFactor);
    const tableWidth = widths.reduce((a, b) => a + b, 0);
    const startX = leftMargin + (availableWidth - tableWidth) / 2;

    const alignOf = (i) => (columnAligns && columnAligns[i] === 'right' ? 'right' : 'left');
    const cellWidthOf = (i) => Math.max(widths[i] - (cellPadding * 2), 10);

    // Tinggi header otomatis (agar teks header tidak terpotong/meluber)
    const headerRowHeight = headers.reduce((max, header, i) => {
        const height = doc.heightOfString(String(header), { width: cellWidthOf(i) });
        return Math.max(max, height);
    }, minHeaderHeight) + (cellPadding * 2);

    const drawHeaderRow = (y) => {
        doc.fillColor('#edf2f7').rect(startX, y, tableWidth, headerRowHeight).fill();
        doc.fillColor('#2d3748').fontSize(headerFontSize).font('Helvetica-Bold');
        let x = startX;
        headers.forEach((header, i) => {
            doc.text(header, x + cellPadding, y + cellPadding, {
                width: cellWidthOf(i),
                align: alignOf(i)
            });
            x += widths[i];
        });
    };

    drawHeaderRow(currentY);
    currentY += headerRowHeight;

    // Draw rows
    doc.font('Helvetica').fontSize(fontSize).fillColor('#4a5568');
    rows.forEach((row, rowIndex) => {
        // Tinggi baris otomatis mengikuti isi terpanjang agar tidak saling menimpa
        const rowHeight = row.reduce((max, cell, i) => {
            const height = doc.heightOfString(String(cell), { width: cellWidthOf(i) });
            return Math.max(max, height);
        }, minRowHeight) + (cellPadding * 2);

        // Check for new page
        if (currentY + rowHeight > pageBottom) {
            pageNum = addFooterAndNewPage(doc, pageNum);
            currentY = 50;

            // Redraw headers on new page
            drawHeaderRow(currentY);
            currentY += headerRowHeight;
            doc.font('Helvetica').fontSize(fontSize).fillColor('#4a5568');
        }

        // Draw background for alternate rows
        if (rowIndex % 2 === 1) {
            doc.fillColor('#f7fafc').rect(startX, currentY, tableWidth, rowHeight).fill();
        }

        doc.fillColor('#4a5568');
        let x = startX;
        row.forEach((cell, i) => {
            doc.text(String(cell), x + cellPadding, currentY + cellPadding, {
                width: cellWidthOf(i),
                align: alignOf(i)
            });
            x += widths[i];
        });
        currentY += rowHeight;
    });

    return { currentY, pageNum };
}
