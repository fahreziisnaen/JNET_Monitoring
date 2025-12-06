const pool = require('../config/database');

/**
 * Get dashboard snapshot untuk instant load
 * Mengembalikan data terbaru yang sudah disimpan di database
 */
exports.getSnapshot = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    
    try {
        // Jika deviceId tidak diberikan, gunakan active_device_id (backward compatibility)
        if (!deviceId) {
            const [workspaces] = await pool.query('SELECT active_device_id FROM workspaces WHERE id = ?', [workspaceId]);
            if (!workspaces[0]?.active_device_id) {
                return res.json({
                    resource: null,
                    traffic: {},
                    pppoeActive: [],
                    activeInterfaces: []
                });
            }
            deviceId = workspaces[0].active_device_id;
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
                pppoeActive: [],
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
            pppoeActive,
            activeInterfaces,
            updatedAt: snapshot.updated_at
        });
    } catch (error) {
        console.error('[Dashboard Snapshot] Error:', error);
        res.status(500).json({ 
            message: 'Gagal mengambil snapshot',
            resource: null,
            traffic: {},
            pppoeActive: [],
            activeInterfaces: []
        });
    }
};

