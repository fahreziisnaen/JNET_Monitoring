const pool = require('../config/database');
const mikrotikStore = require('../utils/mikrotikStore');

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
    const isSummary = req.query.summary === 'true';
    
    try {
        // Jika deviceId tidak diberikan, ambil snapshot batch
        if (!deviceId) {
            let snapshots;
            const summaryColumns = 'device_id, workspace_id, resource, traffic, pppoe_active, updated_at';
            const allColumns = '*';
            const cols = isSummary ? summaryColumns : allColumns;

            if (isSuper && !req.query.workspaceId) {
                // Superadmin gets snapshots for all workspaces
                [snapshots] = await pool.query(`SELECT ${cols} FROM dashboard_snapshot`);
            } else if ((user.role === 'noc' || user.role === 'admin') && !req.query.workspaceId) {
                // NOC/Admin get snapshots for authorized workspaces
                const [perms] = await pool.query('SELECT workspace_id FROM noc_permissions WHERE user_id = ?', [user.id]);
                const authorizedIds = [user.workspace_id, ...perms.map(p => p.workspace_id)];
                [snapshots] = await pool.query(`SELECT ${cols} FROM dashboard_snapshot WHERE workspace_id IN (?)`, [authorizedIds]);
            } else {
                // Regular user or specific workspaceId override
                [snapshots] = await pool.query(
                    `SELECT ${cols} FROM dashboard_snapshot WHERE workspace_id = ?`,
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

            const mappedSnapshots = snapshots.map(s => {
                const pppoeActive = parseJsonField(s.pppoe_active) || [];
                // MikroTik returns "false" as string, but DB might store as 0 or boolean false
                let activeCount = pppoeActive.filter(u => 
                    u.isActive && (u.disabled === 'false' || u.disabled === false || u.disabled === 0 || u.disabled === 'no')
                ).length;
                
                let resource = parseJsonField(s.resource);
                let traffic = parseJsonField(s.traffic) || {};
                let totalUsers = pppoeActive.length;

                // OVERRIDE DENGAN DATA LIVE DARI RAM (JIKA ADA)
                const liveResource = mikrotikStore.getResource(s.workspace_id, s.device_id);
                if (liveResource && Object.keys(liveResource).length > 0) {
                    resource = liveResource;
                    const liveSecrets = mikrotikStore.getSecrets(s.workspace_id, s.device_id);
                    if (liveSecrets && liveSecrets.length > 0) {
                        const liveActive = mikrotikStore.getActive(s.workspace_id, s.device_id);
                        totalUsers = liveSecrets.length;
                        activeCount = liveActive.length;
                    }
                }
                
                return {
                    deviceId: s.device_id,
                    workspaceId: s.workspace_id,
                    resource,
                    traffic,
                    pppoeSecrets: isSummary ? [] : pppoeActive,
                    totalUsers,
                    activeUsers: activeCount,
                    activeInterfaces: parseJsonField(s.active_interfaces) || [],
                    updatedAt: s.updated_at
                };
            });

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
                hotspotActive: [],
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
            hotspotActive: [], // Placeholder
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
            hotspotActive: [],
            activeInterfaces: []
        });
    }
};

