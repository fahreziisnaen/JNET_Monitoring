const pool = require('../config/database');
const { runCommandForWorkspace } = require('../utils/apiConnection');
const mikrotikStore = require('../utils/mikrotikStore');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

exports.getAssets = async (req, res) => {
    let workspaceId = req.user.workspace_id;
    
    // Support override for NOC / Admin / Superadmin
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(req.query.workspaceId);
    }

    if (!workspaceId) {
        return res.json([]);
    }

    try {
        let [assets] = await pool.query(
            `SELECT id, name, type, latitude, longitude, description, splitter_count, parent_asset_id, connection_status, connection_path, owner_name, photo_url
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

            // --- Logika untuk ODC ---
            // Gunakan pendekatan rekursif in-memory (sudah punya semua assets)
            // Ini menangani rantai ODC → ODP → ODP → ... tanpa query tambahan
            const assetById = new Map();
            assets.forEach(a => { if (a && a.id) assetById.set(a.id, a); });

            // Fungsi rekursif: ambil semua ODP descendant dari sebuah assetId
            const getAllOdpDescendants = (parentId) => {
                const result = [];
                assets.forEach(a => {
                    if (a && a.parent_asset_id === parentId && a.type === 'ODP') {
                        result.push(a);
                        // Rekursif: ODP yang parentnya ODP ini
                        result.push(...getAllOdpDescendants(a.id));
                    }
                });
                return result;
            };

            const odcIds = assets.filter(a => a && a.type === 'ODC' && a.id).map(a => a.id);
            if (odcIds.length > 0) {
                assets.forEach(asset => {
                    if (asset && asset.type === 'ODC' && asset.id) {
                        const allODPs = getAllOdpDescendants(asset.id);
                        // totalUsers = jumlah semua ODP descendant
                        asset.totalUsers = allODPs.length;
                        // activeUsers = jumlah ODP descendant yang connection_status = 'terpasang'
                        asset.activeUsers = allODPs.filter(a => a.connection_status === 'terpasang').length;
                    }
                });
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
                     NULL as parent_asset_id, 'terpasang' as connection_status, NULL as connection_path,
                     NULL as owner_name, NULL as photo_url
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
    const { name, type, latitude, longitude, description, splitter_count, connection_status, connection_path, owner_name } = req.body;

    if (!name || !type || !latitude || !longitude) {
        return res.status(400).json({ message: 'Field yang wajib diisi tidak boleh kosong.' });
    }

    try {
        // Simpan owner_name langsung ke network_assets
        const finalOwnerName = owner_name && owner_name.trim() ? owner_name.trim() : null;

        // Handle photo upload
        let photoUrl = null;
        if (req.file) {
            photoUrl = `/public/uploads/assets/${req.file.filename}`;
        }

        const [result] = await pool.query(
            'INSERT INTO network_assets (workspace_id, owner_name, name, type, latitude, longitude, description, splitter_count, connection_status, connection_path, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [workspaceId, finalOwnerName, name, type, latitude, longitude, description || null, splitter_count || null, connection_status || 'terpasang', connection_path || null, photoUrl]
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
    const { name, type, latitude, longitude, description, splitter_count, parent_asset_id, connection_status, connection_path, owner_name } = req.body;

    try {
        // Cek asset lama untuk mendeteksi perubahan parent
        const [oldAssets] = await pool.query(
            'SELECT parent_asset_id FROM network_assets WHERE id = ? AND workspace_id = ?',
            [id, workspaceId]
        );

        if (oldAssets.length === 0) {
            return res.status(404).json({ message: 'Aset tidak ditemukan.' });
        }

        const oldParentId = oldAssets[0].parent_asset_id;
        let shouldResetPath = false;

        // Mendeteksi perubahan parent_asset_id
        if (parent_asset_id !== undefined) {
            const newParentId = (parent_asset_id === '' || parent_asset_id === 'null' || parent_asset_id === null) ? null : parseInt(parent_asset_id);
            if (newParentId !== oldParentId) {
                shouldResetPath = true;
            }
        }
        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (type !== undefined) {
            updates.push('type = ?');
            values.push(type);
        }
        if (latitude !== undefined) {
            updates.push('latitude = ?');
            values.push(latitude);
        }
        if (longitude !== undefined) {
            updates.push('longitude = ?');
            values.push(longitude);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description || null);
        }
        if (splitter_count !== undefined) {
            updates.push('splitter_count = ?');
            values.push(splitter_count || null);
        }
        if (parent_asset_id !== undefined) {
            updates.push('parent_asset_id = ?');
            const finalParentId = (parent_asset_id === '' || parent_asset_id === 'null' || parent_asset_id === null) ? null : parent_asset_id;
            values.push(finalParentId);
        }
        if (shouldResetPath) {
            updates.push('connection_path = ?');
            values.push(null);
        }
        if (connection_status !== undefined) {
            updates.push('connection_status = ?');
            values.push(connection_status || 'terpasang');
        }
        if (connection_path !== undefined) {
            updates.push('connection_path = ?');
            values.push(connection_path || null);
        }
        if (owner_name !== undefined) {
            const finalOwnerName = owner_name && owner_name.trim() ? owner_name.trim() : null;
            updates.push('owner_name = ?');
            values.push(finalOwnerName);
        }
        if (req.file) {
            // Delete old photo if exists
            const [oldAsset] = await pool.query('SELECT photo_url FROM network_assets WHERE id = ? AND workspace_id = ?', [id, workspaceId]);
            if (oldAsset.length > 0 && oldAsset[0].photo_url) {
                const oldPath = path.join(__dirname, '../../', oldAsset[0].photo_url);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }

            const photoUrl = `/public/uploads/assets/${req.file.filename}`;
            updates.push('photo_url = ?');
            values.push(photoUrl);
        } else if (req.body.deletePhoto === 'true') {
            // Handle explicit delete request
            const [oldAsset] = await pool.query('SELECT photo_url FROM network_assets WHERE id = ? AND workspace_id = ?', [id, workspaceId]);
            if (oldAsset.length > 0 && oldAsset[0].photo_url) {
                const oldPath = path.join(__dirname, '../../', oldAsset[0].photo_url);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            updates.push('photo_url = ?');
            values.push(null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Tidak ada data yang diperbarui.' });
        }

        // Jalankan query dinamis
        values.push(id, workspaceId);
        const [result] = await pool.query(
            `UPDATE network_assets SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
            values
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
        // Get photo_url before deleting
        const [asset] = await pool.query('SELECT photo_url FROM network_assets WHERE id = ? AND workspace_id = ?', [id, workspaceId]);

        const [result] = await pool.query(
            'DELETE FROM network_assets WHERE id = ? AND workspace_id = ?',
            [id, workspaceId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Aset tidak ditemukan atau Anda tidak punya izin.' });
        }

        // Delete photo file if exists
        if (asset.length > 0 && asset[0].photo_url) {
            const photoPath = path.join(__dirname, '../../', asset[0].photo_url);
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }
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
        // Get all photos before deleting
        const [assets] = await pool.query('SELECT photo_url FROM network_assets WHERE workspace_id = ? AND photo_url IS NOT NULL', [workspaceId]);

        // Hapus semua aset milik workspace ini
        const [result] = await pool.query(
            'DELETE FROM network_assets WHERE workspace_id = ?',
            [workspaceId]
        );

        // Delete photo files
        assets.forEach(asset => {
            if (asset.photo_url) {
                const photoPath = path.join(__dirname, '../../', asset.photo_url);
                if (fs.existsSync(photoPath)) {
                    fs.unlinkSync(photoPath);
                }
            }
        });

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
                'SELECT id, name FROM network_assets WHERE parent_asset_id = ? AND workspace_id = ? AND type = "ODP"',
                [id, workspace_id]
            );

            if (odpConnections.length === 0) {
                connections = [];
            } else {
                const odpIds = odpConnections.map(c => c.id);
                const placeholders = odpIds.map(() => '?').join(',');

                // Get total clients
                const [totalUsersResult] = await pool.query(
                    `SELECT asset_id, COUNT(*) as count FROM odp_user_connections WHERE asset_id IN (${placeholders}) GROUP BY asset_id`,
                    [...odpIds]
                );
                const totalMap = new Map();
                if (Array.isArray(totalUsersResult)) {
                    totalUsersResult.forEach(r => totalMap.set(r.asset_id, parseInt(r.count) || 0));
                }

                // Get active clients
                const activeMap = new Map();
                try {
                    const [activeUsersResult] = await pool.query(
                        `SELECT ouc.asset_id, COUNT(*) as count 
                         FROM odp_user_connections ouc
                         INNER JOIN pppoe_user_status pus ON ouc.pppoe_secret_name = pus.pppoe_user AND ouc.workspace_id = pus.workspace_id
                         WHERE ouc.asset_id IN (${placeholders}) AND pus.is_active = 1
                         GROUP BY ouc.asset_id`,
                        [...odpIds]
                    );
                    if (Array.isArray(activeUsersResult)) {
                        activeUsersResult.forEach(r => activeMap.set(r.asset_id, parseInt(r.count) || 0));
                    }
                } catch (e) {
                    // Ignore table not found errors for activity
                }

                connections = odpConnections.map(c => ({
                    name: c.name,
                    type: 'ODP',
                    totalUsers: totalMap.get(c.id) || 0,
                    activeUsers: activeMap.get(c.id) || 0
                }));
            }
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

        // Ambil dari odp_user_connections
        const [connectedUsers] = await pool.query(
            'SELECT pppoe_secret_name FROM odp_user_connections WHERE workspace_id = ?',
            [workspace_id]
        );

        // Ambil dari map clients
        const [mappedClients] = await pool.query(
            'SELECT pppoe_secret_name FROM clients WHERE workspace_id = ? AND pppoe_secret_name IS NOT NULL',
            [workspace_id]
        );

        const connectedSecretNames = new Set([
            ...connectedUsers.map(c => c.pppoe_secret_name),
            ...mappedClients.map(c => c.pppoe_secret_name)
        ]);

        const unconnectedSecrets = allSecrets.filter(secret => !connectedSecretNames.has(secret.name));
        res.status(200).json(unconnectedSecrets);
    } catch (error) {
        console.error("GET UNCONNECTED USERS ERROR:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar pengguna yang belum terhubung.' });
    }
};

exports.getAssetOwners = async (req, res) => {
    let workspaceId = req.user.workspace_id;
    
    // Support override for NOC
    if (req.query.workspaceId && (req.user.role === 'admin' || req.user.role === 'noc')) {
        workspaceId = parseInt(req.query.workspaceId);
    }

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

exports.bulkDeleteAssets = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Daftar ID aset tidak valid.' });
    }

    try {
        const placeholders = ids.map(() => '?').join(', ');
        const [result] = await pool.query(
            `DELETE FROM network_assets WHERE id IN (${placeholders}) AND workspace_id = ?`,
            [...ids, workspaceId]
        );
        res.status(200).json({
            message: `Berhasil menghapus ${result.affectedRows} aset.`,
            deleted: result.affectedRows
        });
    } catch (error) {
        console.error('[BULK DELETE ASSETS ERROR]:', error);
        res.status(500).json({ message: 'Gagal menghapus aset.', error: error.message });
    }
};