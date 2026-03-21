const pool = require('../config/database');

/**
 * Get dashboard snapshot untuk instant load
 * Mengembalikan data terbaru yang sudah disimpan di database
 */
exports.getSnapshot = async (req, res) => {
    // Gunakan workspaceId dari query jika ada (untuk NOC/Superadmin), jika tidak gunakan default dari token
    let workspaceId = req.query.workspaceId ? parseInt(req.query.workspaceId) : req.user.workspace_id;
    let deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    
    try {
        // Helper function untuk parse JSON field
        const parseJsonField = (field) => {
            if (!field) return null;
            if (typeof field === 'object' && !Array.isArray(field)) return field;
            if (Array.isArray(field)) return field;
            if (typeof field === 'string') {
                try {
                    return JSON.parse(field);
                } catch (e) {
                    return null;
                }
            }
            return field;
        };

        const processSnapshots = (snapshots) => snapshots.map(s => ({
            deviceId: s.device_id,
            workspaceId: s.workspace_id,
            resource: parseJsonField(s.resource),
            traffic: parseJsonField(s.traffic) || {},
            pppoeSecrets: parseJsonField(s.pppoe_active) || [],
            activeInterfaces: parseJsonField(s.active_interfaces) || [],
            updatedAt: s.updated_at
        }));

        // Jika deviceId tidak diberikan DAN workspaceId tidak diberikan secara eksplisit, 
        // cek apakah Superadmin/NOC butuh semua data teragregasi
        if (!deviceId && !req.query.workspaceId) {
            if (req.user.is_super_admin) {
                const [snapshots] = await pool.query('SELECT * FROM dashboard_snapshot');
                return res.json(processSnapshots(snapshots));
            }
            
            if (req.user.role === 'noc') {
                const [permissions] = await pool.query('SELECT workspace_id FROM noc_permissions WHERE user_id = ?', [req.user.id]);
                const authorizedIds = [req.user.workspace_id, ...permissions.map(p => p.workspace_id)];
                // Menggunakan placeholder ? untuk array ID
                const [snapshots] = await pool.query('SELECT * FROM dashboard_snapshot WHERE workspace_id IN (?)', [authorizedIds]);
                return res.json(processSnapshots(snapshots));
            }
        }

        // Jika deviceId tidak diberikan, ambil snapshot untuk SATU workspace (batch)
        if (!deviceId) {
            const [snapshots] = await pool.query(
                'SELECT * FROM dashboard_snapshot WHERE workspace_id = ?',
                [workspaceId]
            );
            return res.json(processSnapshots(snapshots));
        }
        
        // Single device mode
        const [snapshots] = await pool.query(
            'SELECT * FROM dashboard_snapshot WHERE workspace_id = ? AND device_id = ?',
            [workspaceId, deviceId]
        );
        
        if (snapshots.length === 0) {
            return res.json({
                resource: null,
                traffic: {},
                pppoeSecrets: [],
                activeInterfaces: []
            });
        }
        
        const snapshot = snapshots[0];
        res.json({
            resource: parseJsonField(snapshot.resource),
            traffic: parseJsonField(snapshot.traffic) || {},
            pppoeSecrets: parseJsonField(snapshot.pppoe_active) || [],
            activeInterfaces: parseJsonField(snapshot.active_interfaces) || [],
            updatedAt: snapshot.updated_at
        });
    } catch (error) {
        console.error('[Dashboard Snapshot] Error:', error);
        res.status(500).json({ 
            message: 'Gagal mengambil snapshot',
            resource: null,
            traffic: {},
            pppoeSecrets: [],
            activeInterfaces: []
        });
    }
};
