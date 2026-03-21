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
                         INNER JOIN pppoe_user_status pus 
                            ON ouc.pppoe_secret_name = pus.pppoe_user 
                            AND ouc.workspace_id = pus.workspace_id
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

        // Ambil Clients dengan status aktif dari pppoe_user_status
        const [clients] = await pool.query(`
            SELECT 
                c.*,
                a.name as odp_name, 
                a.owner_name as odp_owner_name, 
                w.name as workspace_name,
                COALESCE(pus.is_active, 0) as isActive
            FROM clients c
            LEFT JOIN network_assets a ON c.odp_asset_id = a.id
            JOIN workspaces w ON c.workspace_id = w.id
            LEFT JOIN pppoe_user_status pus 
                ON c.pppoe_secret_name = pus.pppoe_user 
                AND pus.workspace_id = c.workspace_id
                AND (c.device_id IS NULL OR pus.device_id = c.device_id)
            WHERE c.workspace_id IN (?)
        `, [validWorkspaceIds]);

        // Convert isActive dari TINYINT ke boolean
        const clientsWithBoolean = clients.map(client => ({
            ...client,
            isActive: client.isActive === 1 || client.isActive === true
        }));

        res.json({
            assets,
            clients: clientsWithBoolean
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

        // 1. Ambil metadata workspace & device secara cepat
        const [wRows] = await pool.query('SELECT id, name FROM workspaces WHERE id IN (?)', [validWorkspaceIds]);
        const workspaceMap = new Map(wRows.map(w => [w.id, w.name]));

        const [dRows] = await pool.query('SELECT id, name, workspace_id FROM mikrotik_devices WHERE workspace_id IN (?)', [validWorkspaceIds]);
        const deviceMap = new Map(dRows.map(d => [d.id, { name: d.name, workspace_id: d.workspace_id }]));

        let aggregatedSecrets = [];
        const devicesToFetchFromDb = [];

        // 2. PRIORITAS: Ambil dari RAM (mikrotikStore) - Tercepat
        for (const [deviceId, dMeta] of deviceMap.entries()) {
            const storedSecrets = mikrotikStore.getSecrets(dMeta.workspace_id, deviceId);
            
            if (storedSecrets && storedSecrets.length > 0) {
                const storedActive = mikrotikStore.getActive(dMeta.workspace_id, deviceId);
                const activeMap = new Map(storedActive.map(u => [u.name, u]));
                
                const enriched = storedSecrets.map(secret => {
                    const activeInfo = activeMap.get(secret.name);
                    const isDis = secret.disabled === 'true' || secret.disabled === true;
                    
                    return {
                        name: secret.name,
                        profile: secret.profile || '',
                        'remote-address': secret['remote-address'] || activeInfo?.address || '',
                        disabled: isDis ? 'true' : 'false',
                        isActive: !!activeInfo,
                        uptime: activeInfo?.uptime || '',
                        activeConnectionId: activeInfo?.['.id'] || '',
                        currentAddress: activeInfo?.address || '',
                        deviceId: deviceId,
                        workspace_id: dMeta.workspace_id,
                        workspace_name: workspaceMap.get(dMeta.workspace_id) || '',
                        router_name: dMeta.name || '',
                        mikrotik_status: mikrotikStore.getDeviceStatus(dMeta.workspace_id, deviceId) || 'connected'
                    };
                });
                aggregatedSecrets = aggregatedSecrets.concat(enriched);
            } else {
                devicesToFetchFromDb.push(deviceId);
            }
        }

        // 3. FALLBACK: Jika ada device yang belum ada di RAM, ambil dari DB
        if (devicesToFetchFromDb.length > 0) {
            const [sRows] = await pool.query(`
                SELECT 
                    ps.name, ps.profile, ps.remote_address as 'remote-address',
                    ps.disabled, ps.is_active as isActive, ps.uptime,
                    ps.current_address as currentAddress, ps.active_connection_id as activeConnectionId,
                    ps.workspace_id, ps.device_id,
                    w.name as workspace_name, md.name as router_name
                FROM pppoe_secrets ps
                JOIN workspaces w ON ps.workspace_id = w.id
                JOIN mikrotik_devices md ON ps.device_id = md.id
                WHERE ps.device_id IN (?)
            `, [devicesToFetchFromDb]);

            const dbSecrets = sRows.map(s => {
                return {
                    name: s.name,
                    profile: s.profile || '',
                    'remote-address': s['remote-address'] || s.currentAddress || '',
                    disabled: s.disabled === 1 ? 'true' : 'false',
                    isActive: s.isActive === 1,
                    uptime: s.uptime || '',
                    activeConnectionId: s.activeConnectionId || '',
                    currentAddress: s.currentAddress || '',
                    deviceId: s.device_id,
                    workspace_id: s.workspace_id,
                    workspace_name: s.workspace_name || workspaceMap.get(s.workspace_id) || '',
                    router_name: s.router_name || '',
                    mikrotik_status: mikrotikStore.getDeviceStatus(s.workspace_id, s.device_id) || 'disconnected'
                };
            });
            aggregatedSecrets = aggregatedSecrets.concat(dbSecrets);
        }

        res.json({
            secrets: aggregatedSecrets
        });
    } catch (error) {
        console.error('[NOC Controller] Error getting aggregated secrets:', error);
        res.status(500).json({ message: 'Server error retrieving secrets', error: error.message });
    }
};
// Mendapatkan daftar workspace yang diijinkan bagi user NOC
exports.getMyWorkspaces = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Super admin bisa melihat semua workspace
        if (req.user.is_super_admin) {
            const [workspaces] = await pool.query('SELECT id, name FROM workspaces');
            return res.json(workspaces);
        }

        // NOC/Admin user: tampilkan workspace utama dia + yang diijinkan melalui noc_permissions
        const [workspaces] = await pool.query(`
            SELECT id, name FROM workspaces WHERE id = ?
            UNION
            SELECT w.id, w.name 
            FROM workspaces w
            JOIN noc_permissions np ON w.id = np.workspace_id
            WHERE np.user_id = ?
        `, [req.user.workspace_id, userId]);

        res.json(workspaces);
    } catch (error) {
        console.error('[NOC Controller] Error in getMyWorkspaces:', error);
        res.status(500).json({ message: 'Server error retrieving your workspaces' });
    }
};

// Mendapatkan daftar user yang memiliki akses NOC ke suatu workspace (untuk Management UI)
exports.getNocUsers = async (req, res) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: 'workspaceId is required' });

        const [users] = await pool.query(`
            SELECT u.id, u.username, u.display_name, u.whatsapp_number, np.created_at
            FROM users u
            JOIN noc_permissions np ON u.id = np.user_id
            WHERE np.workspace_id = ?
        `, [workspaceId]);

        res.json(users);
    } catch (error) {
        console.error('[NOC Controller] Error in getNocUsers:', error);
        res.status(500).json({ message: 'Server error retrieving NOC users' });
    }
};

// Memberikan akses NOC ke user tertentu untuk suatu workspace
exports.grantNocAccess = async (req, res) => {
    try {
        const { username, workspaceId } = req.body;
        if (!username || !workspaceId) return res.status(400).json({ message: 'username and workspaceId are required' });

        // Cari user berdasarkan username
        const [users] = await pool.query('SELECT id, role FROM users WHERE username = ? OR whatsapp_number = ?', [username, username]);
        if (users.length === 0) return res.status(404).json({ message: 'User tidak ditemukan' });
        
        const targetUser = users[0];

        // Pastikan role user tersebut adalah 'noc' (opsional: bisa juga otomatis ubah role ke noc?)
        // Untuk amannya, kita izinkan saja siapapun jadi NOC di workspace ini.
        
        await pool.query(
            'INSERT IGNORE INTO noc_permissions (user_id, workspace_id, granted_by) VALUES (?, ?, ?)',
            [targetUser.id, workspaceId, req.user.id]
        );

        // Jika user tersebut tadinya role 'user', kita upgrade ke 'noc' agar bisa melihat menu NOC
        if (targetUser.role === 'user') {
            await pool.query('UPDATE users SET role = "noc" WHERE id = ?', [targetUser.id]);
        }

        res.json({ message: `Berhasil memberikan akses NOC ke ${username}` });
    } catch (error) {
        console.error('[NOC Controller] Error in grantNocAccess:', error);
        res.status(500).json({ message: 'Server error granting NOC access' });
    }
};

// Mencabut akses NOC
exports.revokeNocAccess = async (req, res) => {
    try {
        const { userId, workspaceId } = req.body;
        if (!userId || !workspaceId) return res.status(400).json({ message: 'userId and workspaceId are required' });

        await pool.query(
            'DELETE FROM noc_permissions WHERE user_id = ? AND workspace_id = ?',
            [userId, workspaceId]
        );

        res.json({ message: 'Berhasil mencabut akses NOC' });
    } catch (error) {
        console.error('[NOC Controller] Error in revokeNocAccess:', error);
        res.status(500).json({ message: 'Server error revoking NOC access' });
    }
};
