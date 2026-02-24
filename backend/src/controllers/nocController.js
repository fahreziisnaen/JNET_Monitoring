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
        const [assets] = await pool.query(`
            SELECT a.*, w.name as workspace_name
            FROM network_assets a
            JOIN workspaces w ON a.workspace_id = w.id
            WHERE a.workspace_id IN (?)
        `, [validWorkspaceIds]);

        // Ambil Clients
        const [clients] = await pool.query(`
            SELECT c.*, a.name as odp_name, a.owner_name as odp_owner_name, w.name as workspace_name
            FROM clients c
            LEFT JOIN network_assets a ON c.odp_asset_id = a.id
            JOIN workspaces w ON c.workspace_id = w.id
            WHERE c.workspace_id IN (?)
        `, [validWorkspaceIds]);

        res.json({
            assets,
            clients
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

        // Ambil informasi workspace dan nama mikrotik aktifnya
        const [workspaces] = await pool.query(`
            SELECT w.id, w.name, md.name as router_name 
            FROM workspaces w
            LEFT JOIN mikrotik_devices md ON md.id = w.active_device_id
            WHERE w.id IN (?)
        `, [validWorkspaceIds]);

        let aggregatedSecrets = [];

        // Loop setiap workspace yang diminta
        for (const workspace of workspaces) {
            const workspaceId = workspace.id;

            // Ambil data secrets dan active users dari store realtime (memory) untuk workspace ini
            const secrets = mikrotikStore.getSecrets(workspaceId);
            const activeUsers = mikrotikStore.getActive(workspaceId);
            const status = mikrotikStore.getDeviceStatus(workspaceId);

            // Jika offline atau tidak ada data di store, kita kembalikan array kosong untuk workspace tersebut,
            // atau tambahkan properti penanda
            if (!secrets || secrets.length === 0) {
                continue; // Skip workspace ini jika belum ada data secrets di memory
            }

            // Gabungkan secrets dengan data active seperti di server.js
            const activeUserMap = new Map();
            if (activeUsers) {
                activeUsers.forEach(user => {
                    if (user.name) {
                        activeUserMap.set(user.name, {
                            address: user.address || null,
                            uptime: user.uptime || null,
                            service: user.service || 'pppoe',
                            '.id': user['.id'] || null
                        });
                    }
                });
            }

            const enrichedSecrets = secrets.map(secret => {
                const activeInfo = activeUserMap.get(secret.name);
                const isActive = !!activeInfo;

                const enriched = {
                    ...secret,
                    workspace_name: workspace.name,
                    workspace_id: workspaceId,
                    router_name: workspace.router_name || 'Unknown Router',
                    mikrotik_status: status // Indikasi apakah mikrotiknya connect
                };

                enriched.isActive = isActive;
                if (isActive && activeInfo.uptime) enriched.uptime = activeInfo.uptime;
                if (isActive && activeInfo['.id']) enriched.activeConnectionId = activeInfo['.id'];
                if (isActive && activeInfo.address) {
                    enriched.currentAddress = activeInfo.address;
                    if (!enriched['remote-address']) enriched['remote-address'] = activeInfo.address;
                }

                return enriched;
            });

            aggregatedSecrets = aggregatedSecrets.concat(enrichedSecrets);
        }

        res.json({
            secrets: aggregatedSecrets
        });
    } catch (error) {
        console.error('[NOC Controller] Error getting aggregated secrets:', error);
        res.status(500).json({ message: 'Server error retrieving secrets', error: error.message });
    }
};
