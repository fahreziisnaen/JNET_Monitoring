const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');

exports.getPools = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    try {
        const [pools] = await pool.query(
            'SELECT * FROM ip_pools WHERE workspace_id = ? ORDER BY profile_name ASC',
            [workspaceId]
        );
        res.json(pools);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil data IP Pool.' });
    }
};

// Sync IP pools dari Mikrotik ke database
exports.syncPoolsFromMikrotik = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    try {
        // Ambil IP pools dari Mikrotik
        const mikrotikPools = await runCommandForWorkspace(workspaceId, '/ip/pool/print');
        
        // Ambil profiles dari Mikrotik untuk mapping
        const profiles = await runCommandForWorkspace(workspaceId, '/ppp/profile/print');
        
        // Buat mapping pool name -> pool data
        const poolMap = new Map();
        mikrotikPools.forEach(pool => {
            poolMap.set(pool.name, pool);
        });
        
        let syncedCount = 0;
        let skippedCount = 0;
        
        // Loop melalui setiap profile dan cari IP pool yang digunakan
        for (const profile of profiles) {
            const profileName = profile.name;
            const remoteAddress = profile['remote-address'] || '';
            
            // Di RouterOS, profile menggunakan IP pool melalui field 'remote-address'
            // Format bisa berupa: nama pool (misal: "pool1") atau IP langsung
            // Jika remote-address adalah nama pool, cari di poolMap
            const matchingPool = poolMap.get(remoteAddress);
            
            if (!matchingPool) {
                // Jika tidak ada pool yang match, mungkin remote-address adalah IP langsung
                // Atau profile tidak menggunakan pool
                skippedCount++;
                continue;
            }
            
            // Parse ranges dari Mikrotik pool
            // Format: "10.10.10.2-10.10.10.254" atau "10.10.10.2"
            const ranges = matchingPool.ranges || '';
            let ipStart = null;
            let ipEnd = null;
            
            if (ranges.includes('-')) {
                const [start, end] = ranges.split('-');
                ipStart = start.trim();
                ipEnd = end.trim();
            } else if (ranges) {
                // Jika hanya satu IP, gunakan sebagai start dan end
                ipStart = ranges.trim();
                ipEnd = ranges.trim();
            }
            
            // Ambil gateway dari profile (local-address)
            const gateway = profile['local-address'] || '';
            
            // Jika ada data yang valid, simpan ke database
            if (ipStart && ipEnd && gateway) {
                const sql = `
                    INSERT INTO ip_pools (workspace_id, profile_name, ip_start, ip_end, gateway) 
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE ip_start=VALUES(ip_start), ip_end=VALUES(ip_end), gateway=VALUES(gateway)`;
                await pool.query(sql, [workspaceId, profileName, ipStart, ipEnd, gateway]);
                syncedCount++;
            } else {
                skippedCount++;
            }
        }
        
        res.json({ 
            message: `Sinkronisasi selesai. ${syncedCount} pool berhasil di-sync, ${skippedCount} profile dilewati.`,
            synced: syncedCount,
            skipped: skippedCount
        });
    } catch (error) {
        console.error('[Sync IP Pools] Error:', error);
        res.status(500).json({ message: 'Gagal sinkronisasi IP Pool dari Mikrotik: ' + error.message });
    }
};

exports.addPool = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { profile_name, ip_start, ip_end, gateway } = req.body;
    if (!profile_name || !ip_start || !ip_end || !gateway) {
        return res.status(400).json({ message: 'Semua field wajib diisi.' });
    }
    try {
        const sql = `
            INSERT INTO ip_pools (workspace_id, profile_name, ip_start, ip_end, gateway) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE ip_start=VALUES(ip_start), ip_end=VALUES(ip_end), gateway=VALUES(gateway)`;
        await pool.query(sql, [workspaceId, profile_name, ip_start, ip_end, gateway]);
        res.status(201).json({ message: `IP Pool untuk profil ${profile_name} berhasil disimpan.` });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menyimpan IP Pool.' });
    }
};

exports.deletePool = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { id } = req.params;
    try {
        const [result] = await pool.query(
            'DELETE FROM ip_pools WHERE id = ? AND workspace_id = ?',
            [id, workspaceId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'IP Pool tidak ditemukan.' });
        }
        res.status(200).json({ message: 'IP Pool berhasil dihapus.' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghapus IP Pool.' });
    }
};