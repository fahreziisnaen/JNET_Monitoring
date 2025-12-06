const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');

// Helper function untuk parse rate dari MikroTik (format: "1M", "500K", "1000000", dll)
function parseRateToBps(rateStr) {
    if (!rateStr || rateStr === '0') return 0;
    
    // Jika sudah angka, langsung return (dalam bps)
    const num = parseFloat(rateStr);
    if (!isNaN(num) && !rateStr.match(/[KMGT]/i)) {
        return num;
    }
    
    // Parse format dengan suffix (K, M, G, T)
    const match = rateStr.toString().match(/^([\d.]+)([KMGT]?)$/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    
    const multipliers = {
        'K': 1000,
        'M': 1000000,
        'G': 1000000000,
        'T': 1000000000000
    };
    
    return value * (multipliers[suffix] || 1);
}

// Get all clients for workspace
exports.getClients = async (req, res) => {
    const { workspace_id } = req.user;
    try {
        // Ambil clients dengan status aktif dari pppoe_user_status dan owner ODP
        const [clients] = await pool.query(
            `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.latitude, c.longitude, 
                    c.odp_asset_id, c.created_at, c.updated_at,
                    na.name as odp_name,
                    na.owner_name as odp_owner_name,
                    COALESCE(pus.is_active, FALSE) as isActive
             FROM clients c
             LEFT JOIN network_assets na ON c.odp_asset_id = na.id
             LEFT JOIN pppoe_user_status pus ON c.pppoe_secret_name = pus.pppoe_user AND pus.workspace_id = c.workspace_id
             WHERE c.workspace_id = ?
             ORDER BY c.pppoe_secret_name ASC`,
            [workspace_id]
        );
        
        // Sync: Pastikan semua client yang punya odp_asset_id juga ada di odp_user_connections
        for (const client of clients) {
            if (client.odp_asset_id) {
                const [existingConnection] = await pool.query(
                    'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                );
                
                if (existingConnection.length === 0) {
                    // Tambahkan ke odp_user_connections jika belum ada
                    await pool.query(
                        'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                        [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                    );
                }
            }
        }
        
        // Convert isActive dari TINYINT (0/1) ke boolean
        const clientsWithBoolean = clients.map(client => ({
            ...client,
            isActive: client.isActive === 1 || client.isActive === true
        }));
        
        res.status(200).json(clientsWithBoolean);
    } catch (error) {
        console.error("[GET CLIENTS ERROR]:", error);
        // Fallback jika pppoe_user_status tidak ada atau error
        try {
            const [clients] = await pool.query(
                `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.latitude, c.longitude, 
                        c.odp_asset_id, c.created_at, c.updated_at,
                        na.name as odp_name,
                        FALSE as isActive
                 FROM clients c
                 LEFT JOIN network_assets na ON c.odp_asset_id = na.id
                 WHERE c.workspace_id = ?
                 ORDER BY c.pppoe_secret_name ASC`,
                [workspace_id]
            );
            const clientsWithBoolean = clients.map(client => ({
                ...client,
                isActive: false
            }));
            res.status(200).json(clientsWithBoolean);
        } catch (fallbackError) {
            console.error("[GET CLIENTS FALLBACK ERROR]:", fallbackError);
            res.status(500).json({ message: 'Gagal mengambil data clients.' });
        }
    }
};

// Get unlinked PPPoE secrets (secrets that are not yet clients)
exports.getUnlinkedPppoeSecrets = async (req, res) => {
    const { workspace_id } = req.user;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    try {
        // Get all PPPoE secrets from MikroTik
        const allSecrets = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', ['?disabled=no'], deviceId);
        
        // Get all existing clients
        const [existingClients] = await pool.query(
            'SELECT pppoe_secret_name FROM clients WHERE workspace_id = ?',
            [workspace_id]
        );
        
        const existingClientNames = new Set(existingClients.map(c => c.pppoe_secret_name));
        
        // Get ODP connections untuk setiap PPPoE secret
        const [odpConnections] = await pool.query(
            'SELECT pppoe_secret_name, asset_id FROM odp_user_connections WHERE workspace_id = ?',
            [workspace_id]
        );
        
        // Create map: pppoe_secret_name -> asset_id
        const odpConnectionMap = new Map();
        odpConnections.forEach(conn => {
            odpConnectionMap.set(conn.pppoe_secret_name, conn.asset_id);
        });
        
        // Filter out secrets that are already clients, but include odp_asset_id if connected
        const unlinkedSecrets = allSecrets
            .filter(secret => !existingClientNames.has(secret.name))
            .map(secret => {
                const secretData = { ...secret };
                // Jika PPPoE secret sudah terhubung ke ODP, tambahkan informasi ODP
                if (odpConnectionMap.has(secret.name)) {
                    secretData.connected_odp_id = odpConnectionMap.get(secret.name);
                }
                return secretData;
            });
        
        res.status(200).json(unlinkedSecrets);
    } catch (error) {
        console.error("[GET UNLINKED PPPOE SECRETS ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar PPPoE secrets.' });
    }
};

// Create new client from PPPoE secret
exports.createClient = async (req, res) => {
    const { workspace_id } = req.user;
    const { pppoe_secret_name, latitude, longitude, odp_asset_id } = req.body;
    
    if (!pppoe_secret_name || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: 'pppoe_secret_name, latitude, dan longitude wajib diisi.' });
    }
    
    // Validate coordinates
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ message: 'Koordinat tidak valid.' });
    }
    
    try {
        // Check if client already exists
        const [existing] = await pool.query(
            'SELECT id FROM clients WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [workspace_id, pppoe_secret_name]
        );
        
        if (existing.length > 0) {
            return res.status(409).json({ message: `Client dengan PPPoE secret ${pppoe_secret_name} sudah ada.` });
        }
        
        // Validate ODP if provided
        if (odp_asset_id) {
            const [odpAsset] = await pool.query(
                'SELECT id, type FROM network_assets WHERE id = ? AND workspace_id = ?',
                [odp_asset_id, workspace_id]
            );
            
            if (odpAsset.length === 0) {
                return res.status(404).json({ message: 'ODP tidak ditemukan.' });
            }
            
            if (odpAsset[0].type !== 'ODP') {
                return res.status(400).json({ message: 'Asset yang dipilih bukan ODP.' });
            }
        }
        
        // Check if PPPoE secret already connected to another ODP
        const [existingConnections] = await pool.query(
            'SELECT asset_id FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [workspace_id, pppoe_secret_name]
        );
        
        // If already connected to different ODP, remove old connection
        if (existingConnections.length > 0) {
            const oldOdpId = existingConnections[0].asset_id;
            // If linking to different ODP or unlinking, remove old connection
            if (!odp_asset_id || oldOdpId !== odp_asset_id) {
                await pool.query(
                    'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, oldOdpId, pppoe_secret_name]
                );
            }
        }
        
        // Insert client
        const [result] = await pool.query(
            'INSERT INTO clients (workspace_id, pppoe_secret_name, latitude, longitude, odp_asset_id) VALUES (?, ?, ?, ?, ?)',
            [workspace_id, pppoe_secret_name, lat, lon, odp_asset_id || null]
        );
        
        // If linked to ODP, also add to odp_user_connections if not exists
        if (odp_asset_id) {
            const [existingConnection] = await pool.query(
                'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, odp_asset_id, pppoe_secret_name]
            );
            
            if (existingConnection.length === 0) {
                await pool.query(
                    'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                    [workspace_id, odp_asset_id, pppoe_secret_name]
                );
            }
        }
        
        res.status(201).json({ message: 'Client berhasil dibuat', clientId: result.insertId });
    } catch (error) {
        console.error("[CREATE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal membuat client.' });
    }
};

// Update client (coordinates and ODP link)
exports.updateClient = async (req, res) => {
    const { id } = req.params;
    const { workspace_id } = req.user;
    const { latitude, longitude, odp_asset_id } = req.body;
    
    // Validate coordinates if provided
    let lat = null;
    let lon = null;
    if (latitude !== undefined) {
        lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return res.status(400).json({ message: 'Latitude tidak valid.' });
        }
    }
    if (longitude !== undefined) {
        lon = parseFloat(longitude);
        if (isNaN(lon) || lon < -180 || lon > 180) {
            return res.status(400).json({ message: 'Longitude tidak valid.' });
        }
    }
    
    try {
        // Check if client exists and belongs to workspace
        const [clients] = await pool.query(
            'SELECT id, pppoe_secret_name, odp_asset_id FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );
        
        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }
        
        const client = clients[0];
        const oldOdpId = client.odp_asset_id;
        
        // Validate ODP if provided
        if (odp_asset_id !== undefined) {
            if (odp_asset_id === null) {
                // Unlink from ODP
                // Remove from odp_user_connections
                await pool.query(
                    'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, oldOdpId, client.pppoe_secret_name]
                );
            } else {
                // Link to new ODP
                const [odpAsset] = await pool.query(
                    'SELECT id, type FROM network_assets WHERE id = ? AND workspace_id = ?',
                    [odp_asset_id, workspace_id]
                );
                
                if (odpAsset.length === 0) {
                    return res.status(404).json({ message: 'ODP tidak ditemukan.' });
                }
                
                if (odpAsset[0].type !== 'ODP') {
                    return res.status(400).json({ message: 'Asset yang dipilih bukan ODP.' });
                }
                
                // Remove from old ODP connection if exists
                if (oldOdpId) {
                    await pool.query(
                        'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                        [workspace_id, oldOdpId, client.pppoe_secret_name]
                    );
                }
                
                // Add to new ODP connection if not exists
                const [existingConnection] = await pool.query(
                    'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, odp_asset_id, client.pppoe_secret_name]
                );
                
                if (existingConnection.length === 0) {
                    await pool.query(
                        'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                        [workspace_id, odp_asset_id, client.pppoe_secret_name]
                    );
                }
            }
        }
        
        // Build update query dynamically
        const updates = [];
        const values = [];
        
        if (lat !== null) {
            updates.push('latitude = ?');
            values.push(lat);
        }
        if (lon !== null) {
            updates.push('longitude = ?');
            values.push(lon);
        }
        if (odp_asset_id !== undefined) {
            updates.push('odp_asset_id = ?');
            values.push(odp_asset_id);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Tidak ada data yang diupdate.' });
        }
        
        values.push(id, workspace_id);
        
        await pool.query(
            `UPDATE clients SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
            values
        );
        
        res.status(200).json({ message: 'Client berhasil diupdate' });
    } catch (error) {
        console.error("[UPDATE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengupdate client.' });
    }
};

// Delete client
exports.deleteClient = async (req, res) => {
    const { id } = req.params;
    const { workspace_id } = req.user;
    
    try {
        // Get client info before deletion
        const [clients] = await pool.query(
            'SELECT pppoe_secret_name, odp_asset_id FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );
        
        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }
        
        const client = clients[0];
        
        // Remove from odp_user_connections if linked
        if (client.odp_asset_id) {
            await pool.query(
                'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
            );
        }
        
        // Delete client
        await pool.query(
            'DELETE FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );
        
        res.status(200).json({ message: 'Client berhasil dihapus' });
    } catch (error) {
        console.error("[DELETE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal menghapus client.' });
    }
};

// Store previous traffic data untuk menghitung speed dari selisih
const previousTrafficData = new Map(); // key: workspace_id:pppoe_secret_name, value: { txBytes, rxBytes, timestamp }

// Get single client
exports.getClient = async (req, res) => {
    const { id } = req.params;
    const { workspace_id } = req.user;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    
    try {
        const [clients] = await pool.query(
            `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.latitude, c.longitude, 
                    c.odp_asset_id, c.created_at, c.updated_at,
                    na.name as odp_name,
                    na.owner_name as odp_owner_name
             FROM clients c
             LEFT JOIN network_assets na ON c.odp_asset_id = na.id
             WHERE c.id = ? AND c.workspace_id = ?`,
            [id, workspace_id]
        );
        
        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }
        
        const client = clients[0];
        
        // Sync: Jika client punya odp_asset_id, pastikan ada di odp_user_connections
        if (client.odp_asset_id) {
            const [existingConnection] = await pool.query(
                'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
            );
            
            if (existingConnection.length === 0) {
                // Tambahkan ke odp_user_connections jika belum ada
                await pool.query(
                    'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                    [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                );
            }
        }
        
        // Get PPPoE secret details from MikroTik
        try {
            const [secrets, activeUsers] = await Promise.all([
                runCommandForWorkspace(workspace_id, '/ppp/secret/print', [`?name=${client.pppoe_secret_name}`], deviceId),
                runCommandForWorkspace(workspace_id, '/ppp/active/print', ['?service=pppoe'], deviceId).catch(() => [])
            ]);
            
            let secretData = null;
            if (secrets && secrets.length > 0) {
                secretData = secrets[0];
                
                // Find active user for this secret
                const activeUser = activeUsers.find(au => au.name === client.pppoe_secret_name);
                
                // Get remote address
                let remoteAddress = secretData['remote-address'] || null;
                if (!remoteAddress && activeUser && activeUser.address) {
                    remoteAddress = activeUser.address;
                }
                
                // Get SLA and usage data from database (sama seperti di SLA detail modal)
                let slaData = null;
                let usageData = null;
                
                try {
                    // Get SLA data (uptime percentage dan recent events)
                    const [slaResults] = await pool.query(`
                        SELECT 
                            COUNT(*) as total_events,
                            SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as ongoing_events,
                            SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds
                        FROM downtime_events
                        WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                    `, [workspace_id, client.pppoe_secret_name]);
                    
                    const totalDowntimeSeconds = slaResults[0]?.total_downtime_seconds || 0;
                    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
                    const uptimeSeconds = thirtyDaysInSeconds - totalDowntimeSeconds;
                    const slaPercentage = thirtyDaysInSeconds > 0 ? (uptimeSeconds / thirtyDaysInSeconds) * 100 : 100;
                    
                    // Get recent downtime events
                    const [recentEvents] = await pool.query(`
                        SELECT 
                            start_time,
                            end_time,
                            duration_seconds,
                            CASE WHEN end_time IS NULL THEN 1 ELSE 0 END as is_ongoing
                        FROM downtime_events
                        WHERE workspace_id = ? AND pppoe_user = ?
                        ORDER BY start_time DESC
                        LIMIT 10
                    `, [workspace_id, client.pppoe_secret_name]);
                    
                    // Get usage data (daily, weekly, monthly)
                    const [usageResults] = await pool.query(`
                        SELECT 
                            SUM(CASE WHEN usage_date = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                            SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN total_bytes ELSE 0 END) as weekly,
                            SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN total_bytes ELSE 0 END) as monthly
                        FROM pppoe_usage_logs
                        WHERE workspace_id = ? AND pppoe_user = ?
                    `, [workspace_id, client.pppoe_secret_name]);
                    
                    slaData = {
                        sla_percentage: slaPercentage.toFixed(2),
                        recent_events: recentEvents.map(event => ({
                            start_time: event.start_time,
                            end_time: event.end_time,
                            duration_seconds: event.duration_seconds || 0,
                            is_ongoing: event.is_ongoing === 1
                        }))
                    };
                    
                    usageData = {
                        daily: usageResults[0]?.daily || 0,
                        weekly: usageResults[0]?.weekly || 0,
                        monthly: usageResults[0]?.monthly || 0
                    };
                } catch (slaError) {
                    console.warn(`[GET CLIENT] Error mengambil SLA/usage data:`, slaError.message);
                    slaData = {
                        sla_percentage: '0',
                        recent_events: []
                    };
                    usageData = {
                        daily: 0,
                        weekly: 0,
                        monthly: 0
                    };
                }
                
                // Build response with PPPoE details
                const response = {
                    ...client,
                    pppoe: {
                        name: secretData.name,
                        profile: secretData.profile || 'N/A',
                        'remote-address': remoteAddress,
                        disabled: secretData.disabled === 'true' || secretData.disabled === true,
                        isActive: !!activeUser,
                        uptime: activeUser?.uptime || null,
                        comment: secretData.comment || null
                    },
                    sla: slaData,
                    usage: usageData
                };
                
                return res.status(200).json(response);
            } else {
                // Secret not found in MikroTik - get SLA/usage data anyway
                const [slaResults] = await pool.query(`
                    SELECT 
                        COUNT(*) as total_events,
                        SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as ongoing_events,
                        SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds
                    FROM downtime_events
                    WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ total_downtime_seconds: 0 }]);
                
                const totalDowntimeSeconds = slaResults[0]?.total_downtime_seconds || 0;
                const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
                const uptimeSeconds = thirtyDaysInSeconds - totalDowntimeSeconds;
                const slaPercentage = thirtyDaysInSeconds > 0 ? (uptimeSeconds / thirtyDaysInSeconds) * 100 : 100;
                
                const [recentEvents] = await pool.query(`
                    SELECT start_time, end_time, duration_seconds,
                           CASE WHEN end_time IS NULL THEN 1 ELSE 0 END as is_ongoing
                    FROM downtime_events
                    WHERE workspace_id = ? AND pppoe_user = ?
                    ORDER BY start_time DESC LIMIT 10
                `, [workspace_id, client.pppoe_secret_name]).catch(() => []);
                
                const [usageResults] = await pool.query(`
                    SELECT 
                        SUM(CASE WHEN usage_date = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                        SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN total_bytes ELSE 0 END) as weekly,
                        SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN total_bytes ELSE 0 END) as monthly
                    FROM pppoe_usage_logs
                    WHERE workspace_id = ? AND pppoe_user = ?
                `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ daily: 0, weekly: 0, monthly: 0 }]);
                
                return res.status(200).json({
                    ...client,
                    pppoe: {
                        name: client.pppoe_secret_name,
                        profile: 'N/A',
                        'remote-address': null,
                        disabled: true,
                        isActive: false,
                        uptime: null,
                        comment: null,
                        error: 'PPPoE secret tidak ditemukan di MikroTik'
                    },
                    sla: {
                        sla_percentage: slaPercentage.toFixed(2),
                        recent_events: recentEvents.map(event => ({
                            start_time: event.start_time,
                            end_time: event.end_time,
                            duration_seconds: event.duration_seconds || 0,
                            is_ongoing: event.is_ongoing === 1
                        }))
                    },
                    usage: {
                        daily: usageResults[0]?.daily || 0,
                        weekly: usageResults[0]?.weekly || 0,
                        monthly: usageResults[0]?.monthly || 0
                    }
                });
            }
        } catch (mikrotikError) {
            console.error("[GET CLIENT] Error fetching PPPoE data:", mikrotikError);
            // Get SLA/usage data anyway
            const [slaResults] = await pool.query(`
                SELECT 
                    SUM(CASE WHEN end_time IS NOT NULL THEN duration_seconds ELSE 0 END) as total_downtime_seconds
                FROM downtime_events
                WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ total_downtime_seconds: 0 }]);
            
            const totalDowntimeSeconds = slaResults[0]?.total_downtime_seconds || 0;
            const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
            const uptimeSeconds = thirtyDaysInSeconds - totalDowntimeSeconds;
            const slaPercentage = thirtyDaysInSeconds > 0 ? (uptimeSeconds / thirtyDaysInSeconds) * 100 : 100;
            
            const [recentEvents] = await pool.query(`
                SELECT start_time, end_time, duration_seconds,
                       CASE WHEN end_time IS NULL THEN 1 ELSE 0 END as is_ongoing
                FROM downtime_events
                WHERE workspace_id = ? AND pppoe_user = ?
                ORDER BY start_time DESC LIMIT 10
            `, [workspace_id, client.pppoe_secret_name]).catch(() => []);
            
            const [usageResults] = await pool.query(`
                SELECT 
                    SUM(CASE WHEN usage_date = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                    SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN total_bytes ELSE 0 END) as weekly,
                    SUM(CASE WHEN usage_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN total_bytes ELSE 0 END) as monthly
                FROM pppoe_usage_logs
                WHERE workspace_id = ? AND pppoe_user = ?
            `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ daily: 0, weekly: 0, monthly: 0 }]);
            
            return res.status(200).json({
                ...client,
                pppoe: {
                    name: client.pppoe_secret_name,
                    profile: 'N/A',
                    'remote-address': null,
                    disabled: true,
                    isActive: false,
                    uptime: null,
                    comment: null,
                    error: 'Gagal mengambil data dari MikroTik'
                },
                sla: {
                    sla_percentage: slaPercentage.toFixed(2),
                    recent_events: recentEvents.map(event => ({
                        start_time: event.start_time,
                        end_time: event.end_time,
                        duration_seconds: event.duration_seconds || 0,
                        is_ongoing: event.is_ongoing === 1
                    }))
                },
                usage: {
                    daily: usageResults[0]?.daily || 0,
                    weekly: usageResults[0]?.weekly || 0,
                    monthly: usageResults[0]?.monthly || 0
                }
            });
        }
    } catch (error) {
        console.error("[GET CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengambil data client.' });
    }
};

