const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');
const bcrypt = require('bcryptjs');

exports.getAssets = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!workspaceId) {
        return res.json([]);
    }

    try {
        let [assets] = await pool.query(
            `SELECT id, name, type, latitude, longitude, description, splitter_count, parent_asset_id, connection_status, owner_name
             FROM network_assets
             WHERE workspace_id = ? 
             ORDER BY FIELD(type, 'Mikrotik', 'OLT', 'ODC', 'ODP'), LENGTH(name), name ASC`,
            [workspaceId]
        );
        
        // Pastikan assets adalah array
        if (!Array.isArray(assets)) {
            assets = [];
        }
        
        // Untuk setiap ODP, hitung jumlah user aktif dan total user
        // Set default values dulu untuk semua assets
        if (Array.isArray(assets)) {
            assets.forEach(asset => {
                if (asset) {
                    asset.totalUsers = 0;
                    asset.activeUsers = 0;
                }
            });
            
            // Ambil semua ODP IDs
            const odpIds = assets.filter(a => a && a.type === 'ODP' && a.id).map(a => a.id);
            
            if (odpIds.length > 0) {
                try {
                    // Batch query untuk total users per ODP
                    const placeholders = odpIds.map(() => '?').join(',');
                    const [totalUsersResult] = await pool.query(
                        `SELECT asset_id, COUNT(*) as count 
                         FROM odp_user_connections 
                         WHERE asset_id IN (${placeholders}) AND workspace_id = ? 
                         GROUP BY asset_id`,
                        [...odpIds, workspaceId]
                    );
                    
                    // Map total users ke assets
                    const totalUsersMap = new Map();
                    if (Array.isArray(totalUsersResult)) {
                        totalUsersResult.forEach(row => {
                            if (row && row.asset_id) {
                                totalUsersMap.set(row.asset_id, parseInt(row.count) || 0);
                            }
                        });
                    }
                    
                    // Batch query untuk active users per ODP
                    try {
                        const [activeUsersResult] = await pool.query(
                            `SELECT ouc.asset_id, COUNT(*) as count 
                             FROM odp_user_connections ouc
                             INNER JOIN pppoe_user_status pus ON ouc.pppoe_secret_name = pus.pppoe_user
                             WHERE ouc.asset_id IN (${placeholders}) AND ouc.workspace_id = ? AND pus.workspace_id = ? AND pus.is_active = 1
                             GROUP BY ouc.asset_id`,
                            [...odpIds, workspaceId, workspaceId]
                        );
                        
                        // Map active users ke assets
                        const activeUsersMap = new Map();
                        if (Array.isArray(activeUsersResult)) {
                            activeUsersResult.forEach(row => {
                                if (row && row.asset_id) {
                                    activeUsersMap.set(row.asset_id, parseInt(row.count) || 0);
                                }
                            });
                        }
                        
                        // Update assets dengan user counts
                        assets.forEach(asset => {
                            if (asset && asset.type === 'ODP' && asset.id) {
                                asset.totalUsers = totalUsersMap.get(asset.id) || 0;
                                asset.activeUsers = activeUsersMap.get(asset.id) || 0;
                            }
                        });
                    } catch (statusError) {
                        // Jika tabel pppoe_user_status tidak ada atau error, hanya set totalUsers
                        console.warn('[GET ASSETS] Error getting active users, using totalUsers only:', statusError.message);
                        assets.forEach(asset => {
                            if (asset && asset.type === 'ODP' && asset.id) {
                                asset.totalUsers = totalUsersMap.get(asset.id) || 0;
                                asset.activeUsers = 0;
                            }
                        });
                    }
                } catch (queryError) {
                    console.warn('[GET ASSETS] Error in batch user query:', queryError.message);
                    // Jika error, set default values (sudah di-set di awal)
                }
            }
        }
        
        res.status(200).json(assets || []);
    } catch (error) {
        // Jika error karena kolom tidak ada (owner_id atau parent_asset_id), coba query tanpa kolom tersebut
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            try {
                // Coba query tanpa owner_name dan parent_asset_id jika kolom belum ada
                const [assets] = await pool.query(
                    `SELECT id, name, type, latitude, longitude, description, splitter_count, 
                     NULL as parent_asset_id, 'terpasang' as connection_status,
                     NULL as owner_name
                     FROM network_assets 
                     WHERE workspace_id = ? 
                     ORDER BY FIELD(type, 'Mikrotik', 'OLT', 'ODC', 'ODP'), LENGTH(name), name ASC`,
                    [workspaceId]
                );
                res.status(200).json(assets || []);
            } catch (fallbackError) {
                console.error("GET ASSETS ERROR (fallback):", fallbackError);
                // Return empty array jika masih error, jangan return error status
                res.status(200).json([]);
            }
        } else {
            console.error("GET ASSETS ERROR:", error);
            // Return empty array jika error, bukan error status
            res.status(200).json([]);
        }
    }
};

exports.addAsset = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { name, type, latitude, longitude, description, splitter_count, connection_status, owner_name } = req.body;

    if (!name || !type || !latitude || !longitude) {
        return res.status(400).json({ message: 'Field yang wajib diisi tidak boleh kosong.' });
    }

    try {
        // Simpan owner_name langsung ke network_assets
        const finalOwnerName = owner_name && owner_name.trim() ? owner_name.trim() : null;

        const [result] = await pool.query(
            'INSERT INTO network_assets (workspace_id, owner_name, name, type, latitude, longitude, description, splitter_count, connection_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [workspaceId, finalOwnerName, name, type, latitude, longitude, description || null, splitter_count || null, connection_status || 'terpasang']
        );
        res.status(201).json({ message: 'Aset berhasil ditambahkan', assetId: result.insertId });
    } catch (error) {
        console.error("ADD ASSET ERROR:", error);
        res.status(500).json({ message: 'Gagal menambah aset.' });
    }
};

exports.updateAsset = async (req, res) => {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;
    const { name, type, latitude, longitude, description, splitter_count, parent_asset_id, connection_status, owner_name } = req.body;

    if (!name || !type || !latitude || !longitude) {
        return res.status(400).json({ message: 'Field yang wajib diisi tidak boleh kosong.' });
    }

    try {
        // Validasi parent_asset_id jika di-set
        if (parent_asset_id) {
            // Cek apakah parent asset ada dan milik workspace yang sama
            const [parentAssets] = await pool.query(
                'SELECT id, type FROM network_assets WHERE id = ? AND workspace_id = ?',
                [parent_asset_id, workspaceId]
            );
            
            if (parentAssets.length === 0) {
                return res.status(400).json({ message: 'Parent asset tidak ditemukan.' });
            }
            
            const parentType = parentAssets[0].type;
            
            // Validasi hierarchy baru: Mikrotik -> OLT -> ODC -> ODP (ODP bisa parent dari ODP juga)
            if (type === 'ODP' && parentType !== 'ODC' && parentType !== 'ODP') {
                return res.status(400).json({ message: 'ODP hanya bisa memiliki parent ODC atau ODP.' });
            }
            if (type === 'ODC' && parentType !== 'OLT') {
                return res.status(400).json({ message: 'ODC hanya bisa memiliki parent OLT.' });
            }
            if (type === 'OLT' && parentType !== 'Mikrotik') {
                return res.status(400).json({ message: 'OLT hanya bisa memiliki parent Mikrotik.' });
            }
            if (type === 'Mikrotik') {
                return res.status(400).json({ message: 'Mikrotik tidak bisa memiliki parent.' });
            }
            
            // Cegah circular reference (asset tidak bisa jadi parent dirinya sendiri)
            if (parseInt(parent_asset_id) === parseInt(id)) {
                return res.status(400).json({ message: 'Asset tidak bisa menjadi parent dirinya sendiri.' });
            }
        }

        // Simpan owner_name langsung ke network_assets
        const finalOwnerName = owner_name && owner_name.trim() ? owner_name.trim() : null;
        
        const [result] = await pool.query(
            'UPDATE network_assets SET name = ?, type = ?, latitude = ?, longitude = ?, description = ?, splitter_count = ?, parent_asset_id = ?, connection_status = ?, owner_name = ? WHERE id = ? AND workspace_id = ?',
            [name, type, latitude, longitude, description || null, splitter_count || null, parent_asset_id || null, connection_status || 'terpasang', finalOwnerName, id, workspaceId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Aset tidak ditemukan atau Anda tidak punya izin.' });
        }
        res.status(200).json({ message: 'Aset berhasil diperbarui.' });
    } catch (error) {
        console.error("UPDATE ASSET ERROR:", error);
        res.status(500).json({ message: 'Gagal memperbarui aset.', error: error.message });
    }
};

exports.deleteAsset = async (req, res) => {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;

    try {
        const [result] = await pool.query(
            'DELETE FROM network_assets WHERE id = ? AND workspace_id = ?',
            [id, workspaceId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Aset tidak ditemukan atau Anda tidak punya izin.' });
        }
        res.status(200).json({ message: 'Aset berhasil dihapus.' });
    } catch (error) {
        console.error("DELETE ASSET ERROR:", error);
        res.status(500).json({ message: 'Gagal menghapus aset.' });
    }
};

exports.deleteAllAssets = async (req, res) => {
    const workspaceId = req.user.workspace_id;

    try {
        // Hapus semua aset milik workspace ini
        // Foreign key constraint akan otomatis menghapus:
        // - odp_user_connections yang terkait
        // - child assets (karena parent_asset_id akan di-set NULL atau dihapus)
        const [result] = await pool.query(
            'DELETE FROM network_assets WHERE workspace_id = ?',
            [workspaceId]
        );

        res.status(200).json({ 
            message: `Berhasil menghapus ${result.affectedRows} aset.`,
            deletedCount: result.affectedRows
        });
    } catch (error) {
        console.error("DELETE ALL ASSETS ERROR:", error);
        res.status(500).json({ message: 'Gagal menghapus semua aset.', error: error.message });
    }
};

exports.getAssetConnections = async (req, res) => {
    const { id } = req.params;
    const { workspace_id } = req.user;

    try {
        const [assets] = await pool.query('SELECT type FROM network_assets WHERE id = ? AND workspace_id = ?', [id, workspace_id]);
        if (assets.length === 0) {
            return res.status(404).json({ message: 'Aset tidak ditemukan.' });
        }
        const assetType = assets[0].type;
        let connections = [];
        if (assetType === 'ODP') {
            const [userConnections] = await pool.query(
                'SELECT pppoe_secret_name FROM odp_user_connections WHERE asset_id = ? AND workspace_id = ?',
                [id, workspace_id]
            );
            connections = userConnections.map(c => ({ name: c.pppoe_secret_name, type: 'user' }));
        } else if (assetType === 'ODC') {
            const [odpConnections] = await pool.query(
                'SELECT name FROM network_assets WHERE parent_asset_id = ? AND workspace_id = ?',
                [id, workspace_id]
            );
            connections = odpConnections.map(c => ({ name: c.name, type: 'ODP' }));
        }
        res.status(200).json(connections);
    } catch (error) {
        console.error("GET ASSET CONNECTIONS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil data koneksi aset.' });
    }
};

exports.addAssetConnection = async (req, res) => {
    const { id: assetId } = req.params;
    const { pppoe_secret_name } = req.body;
    const { workspace_id } = req.user;
    if (!pppoe_secret_name) {
        return res.status(400).json({ message: 'Nama pengguna PPPoE wajib diisi.' });
    }
    
    try {
        // Validasi bahwa asset adalah ODP
        const [assets] = await pool.query(
            'SELECT type FROM network_assets WHERE id = ? AND workspace_id = ?',
            [assetId, workspace_id]
        );
        if (assets.length === 0) {
            return res.status(404).json({ message: 'ODP tidak ditemukan.' });
        }
        if (assets[0].type !== 'ODP') {
            return res.status(400).json({ message: 'Hanya ODP yang bisa memiliki koneksi user.' });
        }
        
        // Cek apakah connection sudah ada
        const [existing] = await pool.query(
            'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
            [workspace_id, assetId, pppoe_secret_name]
        );
        if (existing.length > 0) {
            return res.status(409).json({ message: `User ${pppoe_secret_name} sudah terhubung ke ODP ini.` });
        }
        
        // Cek apakah user sudah terhubung ke ODP lain
        const [existingConnections] = await pool.query(
            'SELECT asset_id FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [workspace_id, pppoe_secret_name]
        );
        
        // Jika sudah terhubung ke ODP lain, hapus connection lama
        if (existingConnections.length > 0) {
            const oldOdpId = existingConnections[0].asset_id;
            await pool.query(
                'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, oldOdpId, pppoe_secret_name]
            );
            
            // Update clients.odp_asset_id untuk ODP lama menjadi NULL
            await pool.query(
                'UPDATE clients SET odp_asset_id = NULL WHERE workspace_id = ? AND pppoe_secret_name = ? AND odp_asset_id = ?',
                [workspace_id, pppoe_secret_name, oldOdpId]
            );
        }
        
        // Tambahkan connection baru ke odp_user_connections
        const [result] = await pool.query(
            'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
            [workspace_id, assetId, pppoe_secret_name]
        );
        
        // Sync: Update clients.odp_asset_id jika client sudah ada
        await pool.query(
            'UPDATE clients SET odp_asset_id = ? WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [assetId, workspace_id, pppoe_secret_name]
        );
        
        res.status(201).json({ message: 'Koneksi berhasil ditambahkan', connectionId: result.insertId });
    } catch (error) {
        console.error("ADD ASSET CONNECTION ERROR:", error);
        res.status(500).json({ message: 'Gagal menambah koneksi aset.', error: error.message });
    }
};

exports.getUnconnectedPppoeUsers = async (req, res) => {
    const { workspace_id } = req.user;
    try {
        const allSecrets = await runCommandForWorkspace(workspace_id, '/ppp/secret/print', ['?disabled=no']);
        const [connectedUsers] = await pool.query(
            'SELECT pppoe_secret_name FROM odp_user_connections WHERE workspace_id = ?',
            [workspace_id]
        );
        const connectedSecretNames = new Set(connectedUsers.map(c => c.pppoe_secret_name));
        const unconnectedSecrets = allSecrets.filter(secret => !connectedSecretNames.has(secret.name));
        res.status(200).json(unconnectedSecrets);
    } catch (error) {
        console.error("GET UNCONNECTED USERS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar pengguna yang belum terhubung.' });
    }
};

exports.getAssetOwners = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    if (!workspaceId) {
        console.log("[GET ASSET OWNERS] No workspace_id found for user:", req.user.id);
        return res.json([]);
    }

    try {
        // Ambil DISTINCT owner_name dari network_assets
        const [owners] = await pool.query(
            `SELECT DISTINCT owner_name as name 
             FROM network_assets 
             WHERE workspace_id = ? AND owner_name IS NOT NULL AND owner_name != '' 
             ORDER BY owner_name ASC`,
            [workspaceId]
        );
        
        // Format response untuk kompatibilitas dengan frontend (menambahkan id dummy)
        const formattedOwners = owners.map((owner, index) => ({
            id: index + 1, // Dummy ID karena tidak ada ID sebenarnya
            name: owner.name
        }));
        
        console.log(`[GET ASSET OWNERS] Found ${formattedOwners.length} owners for workspace ${workspaceId}:`, formattedOwners);
        res.json(formattedOwners);
    } catch (error) {
        console.error("GET ASSET OWNERS ERROR:", error);
        res.json([]);
    }
};

exports.addAssetOwner = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { name } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Nama pemilik asset wajib diisi.' });
    }

    try {
        // Karena owner_name disimpan langsung di network_assets, 
        // kita hanya perlu memastikan bahwa owner_name ini sudah ada di database
        // dengan cara mengecek apakah sudah ada asset dengan owner_name tersebut
        const [existing] = await pool.query(
            'SELECT DISTINCT owner_name FROM network_assets WHERE workspace_id = ? AND owner_name = ?',
            [workspaceId, name.trim()]
        );
        
        if (existing.length > 0) {
            // Owner sudah ada di database
            return res.json({ 
                message: 'Pemilik asset sudah ada', 
                id: 1, // Dummy ID
                name: name.trim() 
            });
        }
        
        // Owner belum ada, tapi tidak perlu insert karena akan otomatis tersimpan saat asset dibuat/diupdate
        // Kita hanya return success untuk kompatibilitas dengan frontend
        res.status(201).json({ 
            message: 'Pemilik asset siap digunakan', 
            id: 1, // Dummy ID
            name: name.trim() 
        });
    } catch (error) {
        console.error("ADD ASSET OWNER ERROR:", error);
        res.status(500).json({ message: 'Gagal menambah pemilik asset.' });
    }
};

exports.getWorkspaceUsers = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    try {
        const [users] = await pool.query(
            'SELECT id, username, display_name FROM users WHERE workspace_id = ? ORDER BY display_name, username ASC',
            [workspaceId]
        );
        res.status(200).json(users);
    } catch (error) {
        console.error("GET WORKSPACE USERS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar pengguna workspace.' });
    }
};

exports.addWorkspaceUser = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { username, displayName, password, whatsappNumber } = req.body;

    if (!username || !displayName || !password) {
        return res.status(400).json({ message: 'Username, nama display, dan password wajib diisi.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: 'Password minimal 6 karakter.' });
    }

    try {
        // Cek apakah username sudah ada
        const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Username sudah digunakan.' });
        }

        // Cek apakah WhatsApp number sudah ada (jika diisi)
        if (whatsappNumber) {
            const [existingWhatsApp] = await pool.query('SELECT id FROM users WHERE whatsapp_number = ?', [whatsappNumber]);
            if (existingWhatsApp.length > 0) {
                return res.status(400).json({ message: 'Nomor WhatsApp sudah digunakan.' });
            }
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Set default avatar URL
        const avatarUrl = '/public/uploads/avatars/default.jpg';

        // Insert user baru dengan workspace_id yang sama
        const [result] = await pool.query(
            'INSERT INTO users (username, display_name, password_hash, whatsapp_number, profile_picture_url, workspace_id) VALUES (?, ?, ?, ?, ?, ?)',
            [username, displayName, passwordHash, whatsappNumber || null, avatarUrl, workspaceId]
        );

        res.status(201).json({ 
            message: 'Pengguna berhasil ditambahkan ke workspace.',
            userId: result.insertId
        });
    } catch (error) {
        console.error("ADD WORKSPACE USER ERROR:", error);
        res.status(500).json({ message: 'Gagal menambahkan pengguna ke workspace.', error: error.message });
    }
};