const pool = require('../config/database');
const withTransaction = require('../utils/withTransaction');
const { runCommandForWorkspace } = require('../utils/apiConnection');
const mikrotikStore = require('../utils/mikrotikStore');
const path = require('path');
const fs = require('fs');

// Helper function untuk parse rate dari MikroTik (format: "1M", "500K", "1000000", dll)
function parseRateToBps(rateStr) {
    if (!rateStr || rateStr === '0') return 0;

    // Jika sudah angka, langsung return (dalam bps)
    const num = parseFloat(rateStr);
    if (!isNaN(num) && !rateStr.match(/[KMGT]/i)) {
        return num;
    }

    // Parse format dengan suffix (K, M, G, T)
    const match = rateStr.toString().match(/^([\d.]+)([KMGT]?)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();

    const multipliers = {
        'K': 1000,
        'M': 1000000,
        'G': 1000000000,
        'T': 1000000000000
    };

    return value * (multipliers[suffix] || 1);
}

// Get all clients for workspace
exports.getClients = async (req, res) => {
    let { workspace_id } = req.user;
    
    try {
        // Auto-heal device_id: jika ada client dengan device_id usang/NULL atau berbeda dari pppoe_secrets saat ini
        try {
            // 1. Sinkronkan clients.device_id dengan device_id dari pppoe_secrets yang ada di workspace ini
            await pool.query(
                `UPDATE clients c
                 JOIN pppoe_secrets ps ON c.workspace_id = ps.workspace_id AND c.pppoe_secret_name = ps.name
                 SET c.device_id = ps.device_id
                 WHERE c.workspace_id = ? AND (c.device_id IS NULL OR c.device_id != ps.device_id)`,
                [workspace_id]
            );

            // 2. Jika device_id pada client menunjuk ke device yang sudah tidak ada di mikrotik_devices
            const [availableDevices] = await pool.query(
                'SELECT id FROM mikrotik_devices WHERE workspace_id = ?',
                [workspace_id]
            );

            if (availableDevices.length === 1) {
                // Jika hanya ada 1 device di workspace, kaitkan client ke device tersebut
                await pool.query(
                    `UPDATE clients SET device_id = ? WHERE workspace_id = ? AND (device_id IS NULL OR device_id != ?)`,
                    [availableDevices[0].id, workspace_id, availableDevices[0].id]
                );
            } else if (availableDevices.length > 1) {
                // Jika ada beberapa device, bersihkan device_id yang sudah tidak valid
                const validIds = availableDevices.map(d => d.id);
                await pool.query(
                    `UPDATE clients SET device_id = NULL WHERE workspace_id = ? AND device_id NOT IN (?)`,
                    [workspace_id, validIds]
                );
            }
        } catch (healErr) {
            console.warn('[getClients] Auto-heal device_id warning:', healErr.message);
        }

        // Ambil clients dengan status aktif dari pppoe_secrets / pppoe_user_status dan owner ODP
        const [clients] = await pool.query(
            `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.client_name, c.whatsapp_number, c.latitude, c.longitude, 
                    c.odp_asset_id, c.connection_path, c.photo_url, c.created_at, c.updated_at,
                    c.device_id as stored_device_id,
                    na.name as odp_name,
                    na.owner_name as odp_owner_name,
                    COALESCE(ps.device_id, pus.device_id, c.device_id) as device_id,
                    COALESCE(ps.is_active, pus.is_active, FALSE) as isActive
             FROM clients c
             LEFT JOIN network_assets na ON c.odp_asset_id = na.id
             LEFT JOIN pppoe_secrets ps ON c.workspace_id = ps.workspace_id AND c.pppoe_secret_name = ps.name
             LEFT JOIN pppoe_user_status pus ON c.pppoe_secret_name = pus.pppoe_user 
                 AND pus.workspace_id = c.workspace_id
                 AND (c.device_id IS NULL OR pus.device_id = c.device_id)
             WHERE c.workspace_id = ?
             ORDER BY c.pppoe_secret_name ASC`,
            [workspace_id]
        );

        // Sync: Pastikan semua client yang punya odp_asset_id juga ada di odp_user_connections
        for (const client of clients) {
            if (client.odp_asset_id) {
                const [existingConnection] = await pool.query(
                    'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                );

                if (existingConnection.length === 0) {
                    // Tambahkan ke odp_user_connections jika belum ada
                    await pool.query(
                        'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                        [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                    );
                }
            }
        }

        // Convert isActive dari TINYINT (0/1) ke boolean dan tambahkan isOffline flag
        const clientsWithBoolean = clients.map(client => {
            const deviceStatus = client.device_id ? mikrotikStore.getDeviceStatus(workspace_id, client.device_id) : 'connected';
            const isOfflineDevice = deviceStatus === 'disconnected';
            return {
                ...client,
                isActive: (client.isActive === 1 || client.isActive === true) && !isOfflineDevice,
                isOffline: isOfflineDevice
            };
        });

        res.status(200).json(clientsWithBoolean);
    } catch (error) {
        console.error("[GET CLIENTS ERROR]:", error);
        // Fallback jika pppoe_user_status tidak ada atau error
        try {
            const [clients] = await pool.query(
                `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.client_name, c.whatsapp_number, c.latitude, c.longitude, 
                        c.odp_asset_id, c.photo_url, c.created_at, c.updated_at,
                        c.device_id,
                        na.name as odp_name,
                        FALSE as isActive
                 FROM clients c
                 LEFT JOIN network_assets na ON c.odp_asset_id = na.id
                 WHERE c.workspace_id = ?
                 ORDER BY c.pppoe_secret_name ASC`,
                [workspace_id]
            );
            const clientsWithBoolean = clients.map(client => ({
                ...client,
                isActive: false,
                isOffline: false
            }));
            res.status(200).json(clientsWithBoolean);
        } catch (fallbackError) {
            console.error("[GET CLIENTS FALLBACK ERROR]:", fallbackError);
            res.status(500).json({ message: 'Gagal mengambil data clients.' });
        }
    }
};

// Check which clients are orphaned (PPPoE secret no longer exists on any active device in workspace)
exports.orphanCheck = async (req, res) => {
    const { workspace_id } = req.user;
    try {
        // 1. Ambil semua secret yang ada di workspace ini dari cache pppoe_secrets
        const [allSecrets] = await pool.query(
            'SELECT name, device_id FROM pppoe_secrets WHERE workspace_id = ?',
            [workspace_id]
        );

        // Jika cache pppoe_secrets kosong (misal baru start/reconnect), jangan tandai false orphan
        if (allSecrets.length === 0) {
            return res.status(200).json({ orphanedIds: [] });
        }

        // Map lowercase trimmed secret name -> device_id
        const secretDeviceMap = new Map();
        allSecrets.forEach(s => {
            const key = (s.name || '').trim().toLowerCase();
            if (key && !secretDeviceMap.has(key)) {
                secretDeviceMap.set(key, s.device_id);
            }
        });

        // 2. Ambil semua client di workspace ini
        const [clients] = await pool.query(
            'SELECT id, pppoe_secret_name, device_id FROM clients WHERE workspace_id = ?',
            [workspace_id]
        );

        const orphanedIds = [];
        const toHeal = [];

        for (const client of clients) {
            const clientSecretKey = (client.pppoe_secret_name || '').trim().toLowerCase();
            const matchedDeviceId = secretDeviceMap.get(clientSecretKey);

            if (matchedDeviceId !== undefined) {
                // Secret ADA di salah satu router workspace ini!
                // Jika device_id client berbeda dengan router tempat secret berada, jadwalkan heal
                if (client.device_id !== matchedDeviceId) {
                    toHeal.push({ id: client.id, device_id: matchedDeviceId });
                }
            } else {
                // Secret benar-benar tidak ditemukan di router manapun
                orphanedIds.push(client.id);
            }
        }

        // Jalankan auto-heal device_id di background jika ada yang belum sinkron
        if (toHeal.length > 0) {
            for (const h of toHeal) {
                await pool.query('UPDATE clients SET device_id = ? WHERE id = ?', [h.device_id, h.id]).catch(() => {});
            }
        }

        res.status(200).json({ orphanedIds });
    } catch (error) {
        console.error('[ORPHAN CHECK ERROR]:', error);
        res.status(500).json({ message: 'Gagal mengecek orphan status.' });
    }
};

// Get unlinked PPPoE secrets (secrets that are not yet clients)
exports.getUnlinkedPppoeSecrets = async (req, res) => {
    let { workspace_id } = req.user;
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;
    const currentClientId = req.query.currentClientId ? parseInt(req.query.currentClientId) : null;
    // Default tetap sembunyikan secret disabled (dipakai picker billing); peta lokasi mengirim includeDisabled=1
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';

    try {
        // Ambil secrets dari database (diisi oleh backgroundMonitor)
        let query = 'SELECT name, profile, remote_address as `remote-address`, device_id FROM pppoe_secrets WHERE workspace_id = ?';
        let params = [workspace_id];

        if (!includeDisabled) {
            query += ' AND disabled = 0';
        }

        if (deviceId) {
            query += ' AND device_id = ?';
            params.push(deviceId);
        }

        const [allSecrets] = await pool.query(query, params);

        // Get all existing clients (kecuali client yang sedang diedit jika currentClientId disediakan)
        let clientQuery = 'SELECT pppoe_secret_name FROM clients WHERE workspace_id = ?';
        let clientParams = [workspace_id];
        if (currentClientId) {
            clientQuery += ' AND id != ?';
            clientParams.push(currentClientId);
        }
        const [existingClients] = await pool.query(clientQuery, clientParams);

        // Samakan dengan collation MySQL (case-insensitive, abaikan spasi di ujung)
        const normalizeName = (name) => (name || '').trim().toLowerCase();

        const existingClientNames = new Set(existingClients.map(c => normalizeName(c.pppoe_secret_name)));

        // Get ODP connections untuk setiap PPPoE secret
        const [odpConnections] = await pool.query(
            'SELECT pppoe_secret_name, asset_id FROM odp_user_connections WHERE workspace_id = ?',
            [workspace_id]
        );

        // Create map: pppoe_secret_name -> asset_id
        const odpConnectionMap = new Map();
        odpConnections.forEach(conn => {
            odpConnectionMap.set(normalizeName(conn.pppoe_secret_name), conn.asset_id);
        });

        // Filter out secrets that are already clients, but include odp_asset_id if connected
        const unlinkedSecrets = allSecrets
            .filter(secret => !existingClientNames.has(normalizeName(secret.name)))
            .map(secret => {
                const secretData = { ...secret };
                const key = normalizeName(secret.name);
                if (odpConnectionMap.has(key)) {
                    secretData.connected_odp_id = odpConnectionMap.get(key);
                }
                return secretData;
            });

        res.status(200).json(unlinkedSecrets);
    } catch (error) {
        console.error("[GET UNLINKED PPPOE SECRETS ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengambil daftar PPPoE secrets.' });
    }
};

// Create new client from PPPoE secret
exports.createClient = async (req, res) => {
    let { workspace_id } = req.user;


    const { pppoe_secret_name, client_name, whatsapp_number, latitude, longitude, odp_asset_id, connection_path, device_id, ktp_number } = req.body;
    const photo_url = req.file ? `/public/uploads/clients/${req.file.filename}` : null;
    const deviceId = device_id ? parseInt(device_id) : null;

    if (!pppoe_secret_name || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: 'pppoe_secret_name, latitude, dan longitude wajib diisi.' });
    }

    // Validate coordinates
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ message: 'Koordinat tidak valid.' });
    }

    try {
        // Check if client already exists
        const [existing] = await pool.query(
            'SELECT id FROM clients WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [workspace_id, pppoe_secret_name]
        );

        if (existing.length > 0) {
            return res.status(409).json({ message: `Client dengan PPPoE secret ${pppoe_secret_name} sudah ada.` });
        }

        // Validate ODP if provided
        if (odp_asset_id) {
            const [odpAsset] = await pool.query(
                'SELECT id, type FROM network_assets WHERE id = ? AND workspace_id = ?',
                [odp_asset_id, workspace_id]
            );

            if (odpAsset.length === 0) {
                return res.status(404).json({ message: 'ODP tidak ditemukan.' });
            }

            if (odpAsset[0].type !== 'ODP') {
                return res.status(400).json({ message: 'Asset yang dipilih bukan ODP.' });
            }
        }

        // Check if PPPoE secret already connected to another ODP
        const [existingConnections] = await pool.query(
            'SELECT asset_id FROM odp_user_connections WHERE workspace_id = ? AND pppoe_secret_name = ?',
            [workspace_id, pppoe_secret_name]
        );

        // Insert client + tautan ODP dalam satu transaction agar tidak ada state setengah jalan
        const result = await withTransaction(async (conn) => {
            // If already connected to different ODP, remove old connection
            if (existingConnections.length > 0) {
                const oldOdpId = existingConnections[0].asset_id;
                // If linking to different ODP or unlinking, remove old connection
                if (!odp_asset_id || oldOdpId !== odp_asset_id) {
                    await conn.query(
                        'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                        [workspace_id, oldOdpId, pppoe_secret_name]
                    );
                }
            }

            // Insert client (simpan device_id agar JOIN pppoe_user_status nanti lebih akurat)
            const [ins] = await conn.query(
                'INSERT INTO clients (workspace_id, pppoe_secret_name, client_name, whatsapp_number, latitude, longitude, odp_asset_id, connection_path, photo_url, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [workspace_id, pppoe_secret_name, client_name || null, whatsapp_number || null, lat, lon, odp_asset_id || null, connection_path || null, photo_url, deviceId]
            );

            // If linked to ODP, also add to odp_user_connections if not exists
            if (odp_asset_id) {
                const [existingConnection] = await conn.query(
                    'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                    [workspace_id, odp_asset_id, pppoe_secret_name]
                );

                if (existingConnection.length === 0) {
                    await conn.query(
                        'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                        [workspace_id, odp_asset_id, pppoe_secret_name]
                    );
                }
            }

            return ins;
        });

        // Auto-sync ke billing (best-effort; jangan ganggu pembuatan client jika billing gagal/absen).
        let billingCustomerId = null;
        try {
            const { upsertFromClient } = require('../billing/services/customerSyncService');
            await upsertFromClient({
                workspaceId: workspace_id,
                clientId: result.insertId,
                name: client_name,
                whatsapp: whatsapp_number,
                secret: pppoe_secret_name,
                deviceId,
                ktp: ktp_number,
            });
            const [bc] = await pool.query(
                'SELECT id FROM billing_customers WHERE workspace_id = ? AND client_id = ? LIMIT 1',
                [workspace_id, result.insertId]
            );
            billingCustomerId = bc[0]?.id ?? null;
        } catch (syncErr) {
            console.warn('[CREATE CLIENT] auto-sync billing dilewati:', syncErr.message);
        }

        res.status(201).json({ message: 'Client berhasil dibuat', clientId: result.insertId, billingCustomerId });
    } catch (error) {
        console.error("[CREATE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal membuat client.' });
    }
};

// Update client (coordinates and ODP link)
exports.updateClient = async (req, res) => {
    const { id } = req.params;
    let { workspace_id } = req.user;

    
    const { latitude, longitude, connection_path, pppoe_secret_name, client_name, whatsapp_number } = req.body;
    let { odp_asset_id } = req.body;

    // Convert empty string to null for odp_asset_id
    if (odp_asset_id === '' || odp_asset_id === 'null' || odp_asset_id === 'undefined') {
        odp_asset_id = null;
    }

    // Validate coordinates if provided
    let lat = null;
    let lon = null;
    if (latitude !== undefined) {
        lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return res.status(400).json({ message: 'Latitude tidak valid.' });
        }
    }
    if (longitude !== undefined) {
        lon = parseFloat(longitude);
        if (isNaN(lon) || lon < -180 || lon > 180) {
            return res.status(400).json({ message: 'Longitude tidak valid.' });
        }
    }

    try {
        // Check if client exists and belongs to workspace
        const [clients] = await pool.query(
            'SELECT id, pppoe_secret_name, odp_asset_id FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );

        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }

        const client = clients[0];
        const oldOdpId = client.odp_asset_id;

        // Validate ODP if provided (read; sebelum transaction)
        if (odp_asset_id !== undefined && odp_asset_id !== null) {
            const [odpAsset] = await pool.query(
                'SELECT id, type FROM network_assets WHERE id = ? AND workspace_id = ?',
                [odp_asset_id, workspace_id]
            );

            if (odpAsset.length === 0) {
                return res.status(404).json({ message: 'ODP tidak ditemukan.' });
            }

            if (odpAsset[0].type !== 'ODP') {
                return res.status(400).json({ message: 'Asset yang dipilih bukan ODP.' });
            }
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (lat !== null) {
            updates.push('latitude = ?');
            values.push(lat);
        }
        if (lon !== null) {
            updates.push('longitude = ?');
            values.push(lon);
        }
        if (odp_asset_id !== undefined) {
            updates.push('odp_asset_id = ?');
            values.push(odp_asset_id);
        }
        if (connection_path !== undefined) {
            updates.push('connection_path = ?');
            values.push(connection_path);
        }
        if (client_name !== undefined) {
            updates.push('client_name = ?');
            values.push(client_name);
        }
        if (whatsapp_number !== undefined) {
            updates.push('whatsapp_number = ?');
            values.push(whatsapp_number);
        }

        // Handle pppoe_secret_name change (re-pointing client to another secret)
        const newSecretName = pppoe_secret_name ? pppoe_secret_name.trim() : null;
        let targetDeviceId = req.body.device_id ? parseInt(req.body.device_id) : null;

        if (newSecretName && newSecretName !== client.pppoe_secret_name) {
            const [dup] = await pool.query(
                'SELECT id FROM clients WHERE workspace_id = ? AND pppoe_secret_name = ? AND id != ?',
                [workspace_id, newSecretName, id]
            );
            if (dup.length > 0) {
                return res.status(409).json({ message: `Secret "${newSecretName}" sudah digunakan oleh client lain.` });
            }

            if (!targetDeviceId) {
                const [secRows] = await pool.query(
                    'SELECT device_id FROM pppoe_secrets WHERE workspace_id = ? AND name = ? LIMIT 1',
                    [workspace_id, newSecretName]
                );
                if (secRows.length > 0) {
                    targetDeviceId = secRows[0].device_id;
                }
            }

            updates.push('pppoe_secret_name = ?');
            values.push(newSecretName);
        }

        if (targetDeviceId && targetDeviceId !== client.device_id) {
            updates.push('device_id = ?');
            values.push(targetDeviceId);
        }

        // Tentukan foto lama untuk dihapus; file baru dihapus setelah commit (bukan sebelum)
        let oldPhotoToDelete = null;
        if (req.file) {
            const [oldClient] = await pool.query('SELECT photo_url FROM clients WHERE id = ? AND workspace_id = ?', [id, workspace_id]);
            if (oldClient.length > 0 && oldClient[0].photo_url) {
                oldPhotoToDelete = path.join(__dirname, '../../', oldClient[0].photo_url);
            }
            updates.push('photo_url = ?');
            values.push(`/public/uploads/clients/${req.file.filename}`);
        } else if (req.body.deletePhoto === 'true') {
            const [oldClient] = await pool.query('SELECT photo_url FROM clients WHERE id = ? AND workspace_id = ?', [id, workspace_id]);
            if (oldClient.length > 0 && oldClient[0].photo_url) {
                oldPhotoToDelete = path.join(__dirname, '../../', oldClient[0].photo_url);
            }
            updates.push('photo_url = ?');
            values.push(null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Tidak ada data yang diupdate.' });
        }

        values.push(id, workspace_id);

        // Rewiring ODP + update client dalam satu transaction agar tidak ada state setengah jalan
        await withTransaction(async (conn) => {
            const activeSecretName = newSecretName || client.pppoe_secret_name;

            // Jika secret berubah nama, update relasi lama di odp_user_connections
            if (newSecretName && newSecretName !== client.pppoe_secret_name) {
                await conn.query(
                    'UPDATE odp_user_connections SET pppoe_secret_name = ? WHERE workspace_id = ? AND pppoe_secret_name = ?',
                    [newSecretName, workspace_id, client.pppoe_secret_name]
                );
            }

            if (odp_asset_id !== undefined) {
                if (odp_asset_id === null) {
                    // Unlink from ODP + reset kabel karena client tidak punya parent lagi
                    await conn.query(
                        'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                        [workspace_id, oldOdpId, activeSecretName]
                    );
                    await conn.query(
                        'UPDATE clients SET connection_path = NULL WHERE id = ? AND workspace_id = ?',
                        [id, workspace_id]
                    );
                } else {
                    // Remove from old ODP connection if exists
                    if (oldOdpId) {
                        await conn.query(
                            'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                            [workspace_id, oldOdpId, activeSecretName]
                        );
                    }

                    // Reset connection_path karena kabel menuju ODP lama akan kacau setelah ganti ODP
                    if (oldOdpId && oldOdpId !== parseInt(odp_asset_id)) {
                        await conn.query(
                            'UPDATE clients SET connection_path = NULL WHERE id = ? AND workspace_id = ?',
                            [id, workspace_id]
                        );
                    }

                    // Add to new ODP connection if not exists
                    const [existingConnection] = await conn.query(
                        'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                        [workspace_id, odp_asset_id, activeSecretName]
                    );

                    if (existingConnection.length === 0) {
                        await conn.query(
                            'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                            [workspace_id, odp_asset_id, activeSecretName]
                        );
                    }
                }
            }

            await conn.query(
                `UPDATE clients SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
                values
            );
        });

        // Hapus file foto lama setelah commit (aman bila transaction batal)
        if (oldPhotoToDelete && fs.existsSync(oldPhotoToDelete)) {
            try { fs.unlinkSync(oldPhotoToDelete); } catch (e) { console.warn('[UPDATE CLIENT] hapus foto lama gagal:', e.message); }
        }

        // Auto-sync ke billing (best-effort): begitu WA diisi/diubah, pelanggan billing dibuat.
        try {
            const [[fresh]] = await pool.query(
                'SELECT client_name, whatsapp_number, pppoe_secret_name, device_id FROM clients WHERE id = ? AND workspace_id = ?',
                [id, workspace_id]
            );
            if (fresh) {
                const { upsertFromClient } = require('../billing/services/customerSyncService');
                await upsertFromClient({
                    workspaceId: workspace_id,
                    clientId: parseInt(id),
                    name: fresh.client_name,
                    whatsapp: fresh.whatsapp_number,
                    secret: fresh.pppoe_secret_name,
                    deviceId: fresh.device_id,
                });
            }
        } catch (syncErr) {
            console.warn('[UPDATE CLIENT] auto-sync billing dilewati:', syncErr.message);
        }

        res.status(200).json({ message: 'Client berhasil diupdate' });
    } catch (error) {
        console.error("[UPDATE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengupdate client.' });
    }
};

// Delete client
exports.deleteClient = async (req, res) => {
    const { id } = req.params;
    let { workspace_id } = req.user;


    try {
        // Get client info before deletion
        const [clients] = await pool.query(
            'SELECT pppoe_secret_name, odp_asset_id FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );

        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }

        const client = clients[0];

        // Remove from odp_user_connections if linked
        if (client.odp_asset_id) {
            await pool.query(
                'DELETE FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
            );
        }

        // Get photo_url before deleting to remove file
        const [clientPhoto] = await pool.query('SELECT photo_url FROM clients WHERE id = ? AND workspace_id = ?', [id, workspace_id]);
        if (clientPhoto.length > 0 && clientPhoto[0].photo_url) {
            const photoPath = path.join(__dirname, '../../', clientPhoto[0].photo_url);
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
            }
        }

        // Delete client
        await pool.query(
            'DELETE FROM clients WHERE id = ? AND workspace_id = ?',
            [id, workspace_id]
        );

        res.status(200).json({ message: 'Client berhasil dihapus' });
    } catch (error) {
        console.error("[DELETE CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal menghapus client.' });
    }
};

// Store previous traffic data untuk menghitung speed dari selisih
const previousTrafficData = new Map(); // key: workspace_id:pppoe_secret_name, value: { txBytes, rxBytes, timestamp }

// Get single client
exports.getClient = async (req, res) => {
    const { id } = req.params;
    let { workspace_id } = req.user;

    
    const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

    try {
        const [clients] = await pool.query(
            `SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.client_name, c.whatsapp_number, c.latitude, c.longitude, 
                    c.odp_asset_id, c.connection_path, c.photo_url, c.created_at, c.updated_at,
                    na.name as odp_name,
                    na.owner_name as odp_owner_name
             FROM clients c
             LEFT JOIN network_assets na ON c.odp_asset_id = na.id
             WHERE c.id = ? AND c.workspace_id = ?`,
            [id, workspace_id]
        );

        if (clients.length === 0) {
            return res.status(404).json({ message: 'Client tidak ditemukan.' });
        }

        const client = clients[0];

        // Sync: Jika client punya odp_asset_id, pastikan ada di odp_user_connections (async, tidak blocking)
        if (client.odp_asset_id) {
            // Lakukan sync secara async agar tidak blocking response
            pool.query(
                'SELECT id FROM odp_user_connections WHERE workspace_id = ? AND asset_id = ? AND pppoe_secret_name = ?',
                [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
            ).then(([existingConnection]) => {
                if (existingConnection.length === 0) {
                    // Tambahkan ke odp_user_connections jika belum ada (async)
                    pool.query(
                        'INSERT INTO odp_user_connections (workspace_id, asset_id, pppoe_secret_name) VALUES (?, ?, ?)',
                        [workspace_id, client.odp_asset_id, client.pppoe_secret_name]
                    ).catch(err => {
                        console.warn(`[GET CLIENT] Error syncing ODP connection:`, err.message);
                    });
                }
            }).catch(err => {
                console.warn(`[GET CLIENT] Error checking ODP connection:`, err.message);
            });
        }

        // Get PPPoE secret details from MikroTik
        try {
            const [secrets, activeUsers] = await Promise.all([
                runCommandForWorkspace(workspace_id, '/ppp/secret/print', [`?name=${client.pppoe_secret_name}`], deviceId),
                runCommandForWorkspace(workspace_id, '/ppp/active/print', ['?service=pppoe'], deviceId).catch(() => [])
            ]);

            let secretData = null;
            if (secrets && secrets.length > 0) {
                secretData = secrets[0];

                // Find active user for this secret
                const activeUser = activeUsers.find(au => au.name === client.pppoe_secret_name);

                // Get remote address
                let remoteAddress = secretData['remote-address'] || null;
                if (!remoteAddress && activeUser && activeUser.address) {
                    remoteAddress = activeUser.address;
                }

                // Get SLA and usage data from database (parallel untuk performa lebih baik)
                // Menggunakan logika yang sama dengan getSlaDetails dan getUsageHistory
                let slaData = null;
                let usageData = null;

                try {
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                    // Parallel queries untuk SLA dan usage data
                    const [completedDowntimeResult, ongoingDowntimeResult, recentEventsResult, usageResults] = await Promise.all([
                        // Query 1: Hitung completed downtime
                        pool.query(`
                            SELECT COALESCE(SUM(duration_seconds), 0) as total_downtime
                        FROM downtime_events
                            WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NOT NULL
                        `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]),

                        // Query 2: Hitung ongoing downtime
                        pool.query(`
                            SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_time, NOW())), 0) as ongoing_downtime
                            FROM downtime_events
                            WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NULL
                        `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]),

                        // Query 3: Ambil recent events
                        pool.query(`
                        SELECT 
                            start_time,
                                CASE 
                                    WHEN end_time IS NULL THEN TIMESTAMPDIFF(SECOND, start_time, NOW())
                                    ELSE duration_seconds 
                                END as duration_seconds,
                            end_time,
                                end_time IS NULL as is_ongoing
                        FROM downtime_events
                            WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ?
                        ORDER BY start_time DESC
                        LIMIT 10
                        `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]),

                        // Query 4: Get usage data (daily, weekly, monthly)
                        pool.query(`
                        SELECT 
                                SUM(CASE WHEN DATE(usage_date) = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                                SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN total_bytes ELSE 0 END) as weekly,
                                SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN total_bytes ELSE 0 END) as monthly
                        FROM pppoe_usage_logs
                            WHERE workspace_id = ? AND pppoe_user = ? AND DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
                        `, [workspace_id, client.pppoe_secret_name])
                    ]);

                    const completedDowntimeSeconds = parseInt(completedDowntimeResult[0][0]?.total_downtime || 0, 10);
                    const ongoingDowntimeSeconds = parseInt(ongoingDowntimeResult[0][0]?.ongoing_downtime || 0, 10);
                    const totalDowntimeSeconds = completedDowntimeSeconds + ongoingDowntimeSeconds;

                    const totalSecondsInPeriod = 30 * 24 * 60 * 60;
                    const uptimeSeconds = totalSecondsInPeriod - totalDowntimeSeconds;
                    const slaPercentage = (uptimeSeconds / totalSecondsInPeriod) * 100;

                    // Ambil recent events
                    const recentEvents = recentEventsResult[0].map(event => ({
                        start_time: event.start_time,
                        end_time: event.end_time,
                        duration_seconds: event.duration_seconds || 0,
                        is_ongoing: event.is_ongoing === 1 || event.is_ongoing === true
                    }));

                    slaData = {
                        sla_percentage: slaPercentage.toFixed(2),
                        recent_events: recentEvents
                    };

                    usageData = {
                        daily: usageResults[0][0]?.daily || 0,
                        weekly: usageResults[0][0]?.weekly || 0,
                        monthly: usageResults[0][0]?.monthly || 0
                    };
                } catch (slaError) {
                    console.warn(`[GET CLIENT] Error mengambil SLA/usage data:`, slaError.message);
                    slaData = {
                        sla_percentage: '0',
                        recent_events: []
                    };
                    usageData = {
                        daily: 0,
                        weekly: 0,
                        monthly: 0
                    };
                }

                // Build response with PPPoE details
                const response = {
                    ...client,
                    pppoe: {
                        name: secretData.name,
                        profile: secretData.profile || 'N/A',
                        'remote-address': remoteAddress,
                        disabled: secretData.disabled === 'true' || secretData.disabled === true,
                        isActive: !!activeUser,
                        uptime: activeUser?.uptime || null,
                        comment: secretData.comment || null
                    },
                    sla: slaData,
                    usage: usageData
                };

                return res.status(200).json(response);
            } else {
                // Secret not found in MikroTik - get SLA/usage data anyway (parallel)
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const [completedDowntimeResult, ongoingDowntimeResult, recentEventsResult, usageResults] = await Promise.all([
                    pool.query(`
                        SELECT COALESCE(SUM(duration_seconds), 0) as total_downtime
                        FROM downtime_events
                        WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NOT NULL
                    `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]).catch(() => [{ total_downtime: 0 }]),

                    pool.query(`
                        SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_time, NOW())), 0) as ongoing_downtime
                        FROM downtime_events
                        WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NULL
                    `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]).catch(() => [{ ongoing_downtime: 0 }]),

                    pool.query(`
                    SELECT 
                            start_time,
                            CASE 
                                WHEN end_time IS NULL THEN TIMESTAMPDIFF(SECOND, start_time, NOW())
                                ELSE duration_seconds 
                            END as duration_seconds,
                            end_time,
                            end_time IS NULL as is_ongoing
                    FROM downtime_events
                        WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ?
                        ORDER BY start_time DESC
                        LIMIT 10
                    `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]).catch(() => []),

                    pool.query(`
                    SELECT 
                            SUM(CASE WHEN DATE(usage_date) = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                            SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN total_bytes ELSE 0 END) as weekly,
                            SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN total_bytes ELSE 0 END) as monthly
                    FROM pppoe_usage_logs
                        WHERE workspace_id = ? AND pppoe_user = ? AND DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
                    `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ daily: 0, weekly: 0, monthly: 0 }])
                ]);

                const completedDowntimeSeconds = parseInt(completedDowntimeResult[0][0]?.total_downtime || 0, 10);
                const ongoingDowntimeSeconds = parseInt(ongoingDowntimeResult[0][0]?.ongoing_downtime || 0, 10);
                const totalDowntimeSeconds = completedDowntimeSeconds + ongoingDowntimeSeconds;

                const totalSecondsInPeriod = 30 * 24 * 60 * 60;
                const uptimeSeconds = totalSecondsInPeriod - totalDowntimeSeconds;
                const slaPercentage = (uptimeSeconds / totalSecondsInPeriod) * 100;

                const recentEvents = recentEventsResult[0].map(event => ({
                    start_time: event.start_time,
                    end_time: event.end_time,
                    duration_seconds: event.duration_seconds || 0,
                    is_ongoing: event.is_ongoing === 1 || event.is_ongoing === true
                }));

                return res.status(200).json({
                    ...client,
                    pppoe: {
                        name: client.pppoe_secret_name,
                        profile: 'N/A',
                        'remote-address': null,
                        disabled: true,
                        isActive: false,
                        uptime: null,
                        comment: null,
                        error: 'PPPoE secret tidak ditemukan di MikroTik'
                    },
                    sla: {
                        sla_percentage: slaPercentage.toFixed(2),
                        recent_events: recentEvents
                    },
                    usage: {
                        daily: usageResults[0][0]?.daily || 0,
                        weekly: usageResults[0][0]?.weekly || 0,
                        monthly: usageResults[0][0]?.monthly || 0
                    }
                });
            }
        } catch (mikrotikError) {
            console.error("[GET CLIENT] Error fetching PPPoE data:", mikrotikError);
            // Get SLA/usage data anyway (parallel)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const [slaResults, recentEventsResults, usageResults] = await Promise.all([
                pool.query(`
                    SELECT COALESCE(SUM(duration_seconds), 0) as total_downtime
                    FROM downtime_events
                    WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ? AND end_time IS NOT NULL
                `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]).catch(() => [{ total_downtime: 0 }]),

                pool.query(`
                SELECT 
                        COALESCE(SUM(TIMESTAMPDIFF(SECOND, start_time, NOW())), 0) as ongoing_downtime,
                        start_time,
                        CASE 
                            WHEN end_time IS NULL THEN TIMESTAMPDIFF(SECOND, start_time, NOW())
                            ELSE duration_seconds 
                        END as duration_seconds,
                        end_time,
                        end_time IS NULL as is_ongoing
                FROM downtime_events
                    WHERE workspace_id = ? AND pppoe_user = ? AND start_time >= ?
                    ORDER BY start_time DESC
                    LIMIT 10
                `, [workspace_id, client.pppoe_secret_name, thirtyDaysAgo]).catch(() => []),

                pool.query(`
                SELECT 
                        SUM(CASE WHEN DATE(usage_date) = CURDATE() THEN total_bytes ELSE 0 END) as daily,
                        SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN total_bytes ELSE 0 END) as weekly,
                        SUM(CASE WHEN DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN total_bytes ELSE 0 END) as monthly
                FROM pppoe_usage_logs
                    WHERE workspace_id = ? AND pppoe_user = ? AND DATE(usage_date) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
                `, [workspace_id, client.pppoe_secret_name]).catch(() => [{ daily: 0, weekly: 0, monthly: 0 }])
            ]);

            const completedDowntimeSeconds = parseInt(slaResults[0][0]?.total_downtime || 0, 10);
            const ongoingDowntimeSeconds = parseInt(recentEventsResults[0][0]?.ongoing_downtime || 0, 10);
            const totalDowntimeSeconds = completedDowntimeSeconds + ongoingDowntimeSeconds;

            const totalSecondsInPeriod = 30 * 24 * 60 * 60;
            const uptimeSeconds = totalSecondsInPeriod - totalDowntimeSeconds;
            const slaPercentage = (uptimeSeconds / totalSecondsInPeriod) * 100;

            const recentEvents = recentEventsResults[0].slice(0, 10).map(event => ({
                start_time: event.start_time,
                end_time: event.end_time,
                duration_seconds: event.duration_seconds || 0,
                is_ongoing: event.is_ongoing === 1 || event.is_ongoing === true
            }));

            return res.status(200).json({
                ...client,
                pppoe: {
                    name: client.pppoe_secret_name,
                    profile: 'N/A',
                    'remote-address': null,
                    disabled: true,
                    isActive: false,
                    uptime: null,
                    comment: null,
                    error: 'Gagal mengambil data dari MikroTik'
                },
                sla: {
                    sla_percentage: slaPercentage.toFixed(2),
                    recent_events: recentEvents
                },
                usage: {
                    daily: usageResults[0][0]?.daily || 0,
                    weekly: usageResults[0][0]?.weekly || 0,
                    monthly: usageResults[0][0]?.monthly || 0
                }
            });
        }
    } catch (error) {
        console.error("[GET CLIENT ERROR]:", error);
        res.status(500).json({ message: 'Gagal mengambil data client.' });
    }
};

exports.bulkDeleteClients = async (req, res) => {
    const workspaceId = req.user.workspace_id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Daftar ID client tidak valid.' });
    }

    try {
        const placeholders = ids.map(() => '?').join(', ');
        const [result] = await pool.query(
            `DELETE FROM clients WHERE id IN (${placeholders}) AND workspace_id = ?`,
            [...ids, workspaceId]
        );
        res.status(200).json({
            message: `Berhasil menghapus ${result.affectedRows} client.`,
            deleted: result.affectedRows
        });
    } catch (error) {
        console.error('[BULK DELETE CLIENTS ERROR]:', error);
        res.status(500).json({ message: 'Gagal menghapus client.', error: error.message });
    }
};

