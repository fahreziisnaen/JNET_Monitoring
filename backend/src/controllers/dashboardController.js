const pool = require('../config/database');

/**
 * Get dashboard snapshot untuk instant load
 * Mengembalikan data terbaru yang sudah disimpan di database
 */
exports.getSnapshot = async (req, res) => {
    // Gunakan workspaceId dari query jika ada (untuk NOC/Superadmin), jika tidak gunakan default dari token
    const user = req.user;
    let workspaceId = req.query.workspaceId ? parseInt(req.query.workspaceId) : user.workspace_id;
    let deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    // Superadmin bypass: If no workspaceId provided, they might want ALL authorized snapshots
    const isSuper = user.is_super_admin === 1 || user.is_super_admin === true;
    
    try {
        // Jika deviceId tidak diberikan, ambil snapshot batch
        if (!deviceId) {
            let snapshots;
            if (isSuper && !req.query.workspaceId) {
                // Superadmin gets ALL snapshots in the system
                [snapshots] = await pool.query('SELECT * FROM dashboard_snapshot');
            } else if ((user.role === 'noc' || user.role === 'admin') && !req.query.workspaceId) {
                // NOC/Admin get snapshots for authorized workspaces (including their own)
                const [perms] = await pool.query('SELECT workspace_id FROM noc_permissions WHERE user_id = ?', [user.id]);
                const authorizedIds = [user.workspace_id, ...perms.map(p => p.workspace_id)];
                [snapshots] = await pool.query('SELECT * FROM dashboard_snapshot WHERE workspace_id IN (?)', [authorizedIds]);
            } else {
                // Regular user or specific workspaceId override
                [snapshots] = await pool.query(
                    'SELECT * FROM dashboard_snapshot WHERE workspace_id = ?',
                    [workspaceId]
                );
            }
            
            // Helper function untuk parse JSON field
            const parseJsonField = (field) => {
                if (!field) return null;
                if (typeof field === 'object') return field;
                try {
                    return JSON.parse(field);
                } catch (e) {
                    return null;
                }
            };

            const mappedSnapshots = snapshots.map(s => ({
                deviceId: s.device_id,
                workspaceId: s.workspace_id,
                resource: parseJsonField(s.resource),
                traffic: parseJsonField(s.traffic) || {},
                pppoeSecrets: parseJsonField(s.pppoe_active) || [],
                activeInterfaces: parseJsonField(s.active_interfaces) || [],
                updatedAt: s.updated_at
            }));

            return res.json(mappedSnapshots);
        }
        
        const [snapshots] = await pool.query(
            'SELECT * FROM dashboard_snapshot WHERE workspace_id = ? AND device_id = ?',
            [workspaceId, deviceId]
        );
        
        if (snapshots.length === 0) {
            // Jika belum ada snapshot, return data kosong
            return res.json({
                resource: null,
                traffic: {},
                pppoeSecrets: [],
                activeInterfaces: []
            });
        }
        
        const snapshot = snapshots[0];
        
        // Helper function untuk parse JSON field
        // MySQL JSON column bisa mengembalikan object langsung atau string JSON
        const parseJsonField = (field) => {
            if (!field) return null;
            // Jika sudah berupa object, return langsung
            if (typeof field === 'object' && !Array.isArray(field)) {
                return field;
            }
            // Jika sudah berupa array, return langsung
            if (Array.isArray(field)) {
                return field;
            }
            // Jika string, coba parse
            if (typeof field === 'string') {
                try {
                    return JSON.parse(field);
                } catch (e) {
                    console.warn(`[Dashboard Snapshot] Error parsing JSON field:`, e.message);
                    return null;
                }
            }
            return field;
        };
        
        // Parse JSON fields
        let resource = parseJsonField(snapshot.resource);
        let traffic = parseJsonField(snapshot.traffic) || {};
        let pppoeActive = parseJsonField(snapshot.pppoe_active) || [];
        let activeInterfaces = parseJsonField(snapshot.active_interfaces) || [];
        
        res.json({
            resource,
            traffic,
            pppoeSecrets: pppoeActive,
            activeInterfaces,
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

