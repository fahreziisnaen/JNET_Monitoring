const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');

// Mendapatkan data map teragregasi (Asset dan Client) dari beberapa workspace
exports.getAggregatedMapData = async (req, res) => {
    try {
        const { workspaceIds } = req.body;

        if (!workspaceIds || !Array.isArray(workspaceIds) || workspaceIds.length === 0) {
            return res.status(400).json({ message: 'workspaceIds array is required' });
        }

        // Pastikan hanya angka untuk menghindari SQL injection, meskipun parameterized query sudah aman
        const validWorkspaceIds = workspaceIds.filter(id => !isNaN(parseInt(id, 10)));

        if (validWorkspaceIds.length === 0) {
            return res.status(400).json({ message: 'Valid workspaceIds array is required' });
        }

        // Ambil Assets
        const [assetsResult] = await pool.query(`
            SELECT a.*, w.name as workspace_name
            FROM network_assets a
            JOIN workspaces w ON a.workspace_id = w.id
            WHERE a.workspace_id IN (?)
        `, [validWorkspaceIds]);

        let assets = Array.isArray(assetsResult) ? assetsResult : [];

        // Inisialisasi default
        assets.forEach(asset => {
            if (asset) {
                asset.totalUsers = 0;
                asset.activeUsers = 0;
            }
        });

        // ODP Logic
        const odpIds = assets.filter(a => a && a.type === 'ODP' && a.id).map(a => a.id);
        if (odpIds.length > 0) {
            try {
                const placeholders = odpIds.map(() => '?').join(',');
                const [totalUsersResult] = await pool.query(
                    `SELECT asset_id, COUNT(*) as count 
                     FROM odp_user_connections 
                     WHERE asset_id IN (${placeholders}) 
                     GROUP BY asset_id`,
                    [...odpIds]
                );

                const totalUsersMap = new Map();
                if (Array.isArray(totalUsersResult)) {
                    totalUsersResult.forEach(row => {
                        totalUsersMap.set(row.asset_id, parseInt(row.count) || 0);
                    });
                }

                try {
                    const [activeUsersResult] = await pool.query(
                        `SELECT ouc.asset_id, COUNT(*) as count 
                         FROM odp_user_connections ouc
                         INNER JOIN pppoe_user_status pus ON ouc.pppoe_secret_name = pus.pppoe_user AND ouc.workspace_id = pus.workspace_id
                         WHERE ouc.asset_id IN (${placeholders}) AND pus.is_active = 1
                         GROUP BY ouc.asset_id`,
                        [...odpIds]
                    );

                    const activeUsersMap = new Map();
                    if (Array.isArray(activeUsersResult)) {
                        activeUsersResult.forEach(row => {
                            activeUsersMap.set(row.asset_id, parseInt(row.count) || 0);
                        });
                    }

                    assets.forEach(asset => {
                        if (asset && asset.type === 'ODP' && asset.id) {
                            asset.totalUsers = totalUsersMap.get(asset.id) || 0;
                            asset.activeUsers = activeUsersMap.get(asset.id) || 0;
                        }
                    });
                } catch (statusError) {
                    console.warn('[NOC Controller] Error getting active users, using totalUsers only:', statusError.message);
                    assets.forEach(asset => {
                        if (asset && asset.type === 'ODP' && asset.id) {
                            asset.totalUsers = totalUsersMap.get(asset.id) || 0;
                            asset.activeUsers = 0;
                        }
                    });
                }
            } catch (queryError) {
                console.warn('[NOC Controller] Error in batch ODP user query:', queryError.message);
            }
        }

        // ODC Logic
        const odcIds = assets.filter(a => a && a.type === 'ODC' && a.id).map(a => a.id);
        if (odcIds.length > 0) {
            try {
                const placeholders = odcIds.map(() => '?').join(',');

                const [childAssetsResult] = await pool.query(
                    `SELECT parent_asset_id, COUNT(*) as count FROM network_assets WHERE parent_asset_id IN (${placeholders}) GROUP BY parent_asset_id`,
                    [...odcIds]
                );
                const childMap = new Map();
                if (Array.isArray(childAssetsResult)) {
                    childAssetsResult.forEach(row => {
                        childMap.set(row.parent_asset_id, parseInt(row.count) || 0);
                    });
                }

                const [activeChildResult] = await pool.query(
                    `SELECT parent_asset_id, COUNT(*) as count FROM network_assets WHERE parent_asset_id IN (${placeholders}) AND connection_status = 'terpasang' GROUP BY parent_asset_id`,
                    [...odcIds]
                );
                const activeChildMap = new Map();
                if (Array.isArray(activeChildResult)) {
                    activeChildResult.forEach(row => {
                        activeChildMap.set(row.parent_asset_id, parseInt(row.count) || 0);
                    });
                }

                assets.forEach(asset => {
                    if (asset && asset.type === 'ODC' && asset.id) {
                        asset.totalUsers = childMap.get(asset.id) || 0;
                        asset.activeUsers = activeChildMap.get(asset.id) || 0;
                    }
                });
            } catch (queryError) {
                console.warn('[NOC Controller] Error in batch ODC child query:', queryError.message);
            }
        }

        let targetClients = [];
        try {
            // Ambil Clients dengan status aktif dan device_id seperti di halaman Management (clientController)
            const [clients] = await pool.query(`
                SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.client_name, c.whatsapp_number, c.latitude, c.longitude, 
                        c.odp_asset_id, c.connection_path, c.photo_url, c.created_at, c.updated_at,
                        c.device_id as stored_device_id,
                        a.name as odp_name, 
                        a.owner_name as odp_owner_name, 
                        w.name as workspace_name,
                        COALESCE(pus.device_id, c.device_id) as device_id,
                        COALESCE(pus.is_active, FALSE) as isActive
                FROM clients c
                LEFT JOIN network_assets a ON c.odp_asset_id = a.id
                JOIN workspaces w ON c.workspace_id = w.id
                LEFT JOIN pppoe_user_status pus 
                    ON c.pppoe_secret_name = pus.pppoe_user 
                    AND pus.workspace_id = c.workspace_id
                    AND (c.device_id IS NULL OR pus.device_id = c.device_id)
                WHERE c.workspace_id IN (?)
            `, [validWorkspaceIds]);

            targetClients = clients.map(client => {
                const deviceStatus = client.device_id ? mikrotikStore.getDeviceStatus(client.workspace_id, client.device_id) : 'connected';
                const isOfflineDevice = deviceStatus === 'disconnected';
                return {
                    ...client,
                    isActive: (client.isActive === 1 || client.isActive === true) && !isOfflineDevice,
                    isOffline: isOfflineDevice
                };
            });
        } catch (queryErr) {
            console.warn('[NOC Controller] DB schema mismatch for clients, using fallback query:', queryErr.message);
            // Fallback (for DEV environment where device_id might not exist in clients table)
            const [fallbackClients] = await pool.query(`
                SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.client_name, c.whatsapp_number, c.latitude, c.longitude, 
                        c.odp_asset_id, c.connection_path, c.photo_url, c.created_at, c.updated_at,
                        a.name as odp_name, 
                        a.owner_name as odp_owner_name, 
                        w.name as workspace_name,
                        COALESCE(pus.is_active, FALSE) as isActive
                FROM clients c
                LEFT JOIN network_assets a ON c.odp_asset_id = a.id
                JOIN workspaces w ON c.workspace_id = w.id
                LEFT JOIN pppoe_user_status pus 
                    ON c.pppoe_secret_name = pus.pppoe_user 
                    AND pus.workspace_id = c.workspace_id
                WHERE c.workspace_id IN (?)
            `, [validWorkspaceIds]);

            targetClients = fallbackClients.map(client => ({
                ...client,
                isActive: client.isActive === 1 || client.isActive === true,
                isOffline: false
            }));
        }

        res.json({
            assets,
            clients: targetClients
        });
    } catch (error) {
        console.error('[NOC Controller] Error getting aggregated map data:', error);
        res.status(500).json({ message: 'Server error retrieving map data', error: error.message });
    }
};

// Mendapatkan data secrets (PPPoE users) teragregasi dari beberapa workspace
// Karena secret aslinya ada di mikrotik device (store), kita akan menggabungkan dari store lokal jika ada, atau mengambil dari database jika memungkinkan.
// Strategi: Kita ambil device list dari workspace, lalu cek mikrotikStore untuk secrets & active users per device/workspace.
exports.getAggregatedSecrets = async (req, res) => {
    try {
        const { workspaceIds } = req.body;

        if (!workspaceIds || !Array.isArray(workspaceIds) || workspaceIds.length === 0) {
            return res.status(400).json({ message: 'workspaceIds array is required' });
        }

        const validWorkspaceIds = workspaceIds.filter(id => !isNaN(parseInt(id, 10)));

        if (validWorkspaceIds.length === 0) {
            return res.status(400).json({ message: 'Valid workspaceIds array is required' });
        }

        // Ambil data secrets langsung dari database real-time cache (pppoe_secrets)
        const [secrets] = await pool.query(`
            SELECT 
                ps.name, 
                ps.profile, 
                ps.remote_address as 'remote-address',
                ps.disabled,
                ps.is_active as isActive,
                ps.uptime,
                ps.current_address as currentAddress,
                ps.active_connection_id as activeConnectionId,
                ps.workspace_id,
                ps.device_id,
                w.name as workspace_name,
                md.name as router_name
            FROM pppoe_secrets ps
            JOIN workspaces w ON ps.workspace_id = w.id
            LEFT JOIN mikrotik_devices md ON ps.device_id = md.id
            WHERE ps.workspace_id IN (?)
        `, [validWorkspaceIds]);

        // Format boolean dan resolusi status router
        const aggregatedSecrets = secrets.map(s => {
            const secret = { ...s };
            secret.disabled = s.disabled === 1 ? 'true' : 'false';
            secret.isActive = s.isActive === 1;
            
            // Replicate original behavior fallback remote-address
            if (!secret['remote-address'] && secret.currentAddress) {
                secret['remote-address'] = secret.currentAddress;
            }
            
            secret.mikrotik_status = mikrotikStore.getDeviceStatus(s.workspace_id, s.device_id) || 'disconnected';
            return secret;
        });

        res.json({
            secrets: aggregatedSecrets
        });
    } catch (error) {
        console.error('[NOC Controller] Error getting aggregated secrets:', error);
        res.status(500).json({ message: 'Server error retrieving secrets', error: error.message });
    }
};
