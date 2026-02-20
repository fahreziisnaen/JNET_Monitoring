const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const pool = require('../config/database');
const { Builder } = require('xml2js');

// List of tables to backup
const TABLES = [
    'workspaces',
    'users',
    'mikrotik_devices',
    'user_sessions',
    'login_otps',
    'pending_registrations',
    'ip_pools',
    'network_assets',
    'clients',
    'odp_user_connections',
    'downtime_events',
    'pppoe_user_status',
    'workspace_invites',
    'pppoe_usage_logs',
    'resource_logs',
    'alarms',
    'dashboard_snapshot'
];

exports.exportBackup = async (req, res) => {
    const { targetWorkspaceId } = req.query;
    const currentUser = req.user;

    // Tentukan workspace mana yang akan di-backup
    let scopeId = null; // null means FULL backup
    if (!currentUser.is_super_admin) {
        // Jika bukan super admin, paksa ke workspace saat ini
        scopeId = currentUser.workspace_id;
    } else if (targetWorkspaceId && targetWorkspaceId !== 'all') {
        // Super admin memilih workspace tertentu
        scopeId = parseInt(targetWorkspaceId);
    }

    try {
        const backupData = {};
        const photoFiles = new Set(); // Melacak file foto yang harus disertakan

        // 1. Fetch data based on scope
        for (const table of TABLES) {
            let query = `SELECT * FROM ${table}`;
            let params = [];

            if (scopeId) {
                // Filter berdasarkan workspace_id jika scopeId ditentukan
                if (table === 'workspaces') {
                    query += ` WHERE id = ?`;
                    params = [scopeId];
                } else if (['users', 'mikrotik_devices', 'ip_pools', 'network_assets', 'clients', 'odp_user_connections', 'downtime_events', 'pppoe_user_status', 'workspace_invites', 'pppoe_usage_logs', 'resource_logs', 'alarms', 'dashboard_snapshot'].includes(table)) {
                    query += ` WHERE workspace_id = ?`;
                    params = [scopeId];
                } else if (['user_sessions', 'login_otps', 'pending_registrations'].includes(table)) {
                    // Kecualikan data sesi global dari backup per-workspace agar aman
                    continue;
                }
            }

            const [rows] = await pool.query(query, params);
            backupData[table] = rows;

            // Kumpulkan referensi foto
            if (rows.length > 0) {
                rows.forEach(row => {
                    if (table === 'network_assets' && row.photo_url) {
                        const filename = path.basename(row.photo_url);
                        if (filename) photoFiles.add({ folder: 'assets', filename });
                    }
                    if (table === 'clients' && row.photo_url) {
                        const filename = path.basename(row.photo_url);
                        if (filename) photoFiles.add({ folder: 'clients', filename });
                    }
                    if (table === 'users' && row.profile_picture_url) {
                        const filename = path.basename(row.profile_picture_url);
                        if (filename && !filename.startsWith('default')) {
                            photoFiles.add({ folder: 'avatars', filename });
                        }
                    }
                });
            }
        }

        // 2. Prepare ZIP
        const zip = new AdmZip();

        // Add metadata
        const metadata = {
            version: '2.0',
            scope: scopeId ? 'workspace' : 'full',
            workspace_id: scopeId,
            timestamp: new Date().toISOString(),
            exported_by: currentUser.id
        };
        zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));

        // Add database JSON
        zip.addFile('database_backup.json', Buffer.from(JSON.stringify(backupData, null, 2), 'utf8'));

        // 3. Add Photos using the collected Set
        photoFiles.forEach(item => {
            const filePath = path.join(__dirname, '../../public/uploads', item.folder, item.filename);
            if (fs.existsSync(filePath)) {
                zip.addLocalFile(filePath, item.folder);
            }
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const prefix = scopeId ? `jnet-ws${scopeId}-backup` : 'jnet-full-backup';
        const filename = `${prefix}-${timestamp}.zip`;
        const zipBuffer = zip.toBuffer();

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(zipBuffer);

    } catch (error) {
        console.error("EXPORT BACKUP ERROR:", error);
        res.status(500).json({ message: 'Gagal melakukan export backup.', error: error.message });
    }
};

exports.restoreBackup = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Tidak ada file backup yang diunggah.' });
    }

    const { targetWorkspaceId } = req.query;
    const currentUser = req.user;
    const conn = await pool.getConnection();

    try {
        const zip = new AdmZip(req.file.buffer);
        const zipEntries = zip.getEntries();

        // 1. Parse Metadata dan Database JSON
        const metadataEntry = zipEntries.find(e => e.entryName === 'metadata.json');
        const dbEntry = zipEntries.find(e => e.entryName === 'database_backup.json');

        if (!dbEntry) {
            throw new Error('File database_backup.json tidak ditemukan dalam ZIP.');
        }

        const metadata = metadataEntry ? JSON.parse(metadataEntry.getData().toString('utf8')) : { scope: 'full' };
        const backupData = JSON.parse(dbEntry.getData().toString('utf8'));

        // Proteksi: Non-super admin hanya bisa restore workspace miliknya sendiri
        if (!currentUser.is_super_admin) {
            if (metadata.scope !== 'workspace' || parseInt(metadata.workspace_id) !== currentUser.workspace_id) {
                return res.status(403).json({ message: 'Akses ditolak. Anda hanya dapat me-restore backup milik workspace Anda sendiri.' });
            }
        }

        await conn.beginTransaction();

        // ── TARGET REMAPPING LOGIC ───────────────────────────────────────
        let remappingId = null;
        if (currentUser.is_super_admin) {
            if (targetWorkspaceId === 'new') {
                // Buat workspace baru dengan nama dari backup jika ada, atau default
                const backupWorkspaceName = backupData.workspaces?.[0]?.name || 'Restored Workspace';
                const [wsResult] = await conn.query(
                    'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
                    [`${backupWorkspaceName} (Clone)`, currentUser.id]
                );
                remappingId = wsResult.insertId;
                console.log(`[Restore] Created new workspace ${remappingId} for restoration.`);
            } else if (targetWorkspaceId && targetWorkspaceId !== 'all' && targetWorkspaceId !== 'current') {
                remappingId = parseInt(targetWorkspaceId);
                console.log(`[Restore] Target set to existing workspace ${remappingId}.`);
            }
        }
        // ──────────────────────────────────────────────────────────────────

        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        // 2. Clear and Restore Data
        const scopeId = remappingId || (metadata.scope === 'workspace' ? parseInt(metadata.workspace_id) : null);

        for (const table of TABLES) {
            // Hapus data lama sesuai scope (hanya jika bukan "Restored as New")
            // Jika target adalah workspace baru, kita tidak perlu hapus apa-apa
            if (scopeId && targetWorkspaceId !== 'new') {
                if (table === 'workspaces') {
                    await conn.query(`DELETE FROM ${table} WHERE id = ?`, [scopeId]);
                } else if (['users', 'mikrotik_devices', 'ip_pools', 'network_assets', 'clients', 'odp_user_connections', 'downtime_events', 'pppoe_user_status', 'workspace_invites', 'pppoe_usage_logs', 'resource_logs', 'alarms', 'dashboard_snapshot'].includes(table)) {
                    await conn.query(`DELETE FROM ${table} WHERE workspace_id = ?`, [scopeId]);
                } else if (['user_sessions', 'login_otps', 'pending_registrations'].includes(table)) {
                    continue;
                }
            } else if (!scopeId) {
                // Full restore: truncate ALL
                await conn.query(`DELETE FROM ${table}`);
            }

            // Insert data baru
            const rows = backupData[table];
            if (rows && rows.length > 0) {
                const keys = Object.keys(rows[0]);
                const values = rows.map(row => keys.map(key => {
                    let value = row[key];

                    // Remapping Workspace ID
                    if (remappingId) {
                        if (table === 'workspaces' && key === 'id') return remappingId;
                        if (key === 'workspace_id') return remappingId;
                    }

                    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
                        value = value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
                    }
                    return value;
                }));

                const query = `INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(', ')}) VALUES ?`;
                await conn.query(query, [values]);
            }
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.commit();

        // 3. Extract Photos (Assets, Clients, Avatars)
        const folders = ['assets', 'clients', 'avatars'];
        folders.forEach(folder => {
            const destDir = path.join(__dirname, '../../public/uploads', folder);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

            zipEntries.forEach(entry => {
                if (entry.entryName.startsWith(folder + '/') && !entry.isDirectory) {
                    const fileName = path.basename(entry.entryName);
                    if (fileName) {
                        fs.writeFileSync(path.join(destDir, fileName), entry.getData());
                    }
                }
            });
        });

        res.status(200).json({
            message: `Restore ${metadata.scope === 'workspace' ? 'Workspace' : 'Full'} berhasil! Silakan refresh halaman.`
        });

    } catch (error) {
        await conn.rollback().catch(() => { });
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => { });
        console.error("RESTORE BACKUP ERROR:", error);
        res.status(500).json({ message: 'Gagal melakukan restore backup.', error: error.message });
    } finally {
        conn.release();
    }
};

// Tables to backup for factory reset (workspace-scoped data)
// EXCLUDES historical logs to keep backup size small
const WORKSPACE_TABLES = [
    'mikrotik_devices',
    'ip_pools',
    'network_assets',
    'clients',
    'odp_user_connections',
];

// Tables to DELETE during factory reset
const RESET_TABLES = [
    'dashboard_snapshot',
    'resource_logs',
    'pppoe_usage_logs',
    'pppoe_user_status',
    'downtime_events',
    'alarms',
    'odp_user_connections',
    'clients',
    'network_assets',
    'ip_pools',
    'mikrotik_devices',
];

exports.factoryReset = async (req, res) => {
    const { targetWorkspaceId } = req.body;
    const currentUser = req.user;

    // Determine the actual workspace ID to reset
    // Super admin can specify targetWorkspaceId, regular admin resets their own
    let workspaceId = currentUser.workspace_id;
    if (currentUser.is_super_admin && targetWorkspaceId) {
        workspaceId = parseInt(targetWorkspaceId);
    }

    // Validation
    // 1. If not Super Admin, MUST be the owner of the workspace
    if (!currentUser.is_super_admin) {
        if (!currentUser.is_owner) {
            return res.status(403).json({ message: 'Akses ditolak. Hanya Pemilik Workspace atau Super Admin yang dapat melakukan Factory Reset.' });
        }
    }

    const conn = await pool.getConnection();

    try {
        // ── STEP 1: Create workspace-scoped backup ──────────────────────────
        const backupData = {};
        for (const table of WORKSPACE_TABLES) {
            const [rows] = await pool.query(
                `SELECT * FROM ${table} WHERE workspace_id = ?`,
                [workspaceId]
            );
            backupData[table] = rows;
        }

        // Also include workspace & users info (read-only reference)
        const [workspaceRows] = await pool.query('SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
        const [userRows] = await pool.query('SELECT * FROM users WHERE workspace_id = ?', [workspaceId]);
        backupData['workspaces'] = workspaceRows;
        backupData['users'] = userRows;

        const zip = new AdmZip();
        zip.addFile('database_backup.json', Buffer.from(JSON.stringify(backupData, null, 2), 'utf8'));

        // Include avatars
        const avatarDir = path.join(__dirname, '../../public/uploads/avatars');
        if (fs.existsSync(avatarDir)) {
            const files = fs.readdirSync(avatarDir);
            files.forEach(file => {
                const filePath = path.join(avatarDir, file);
                if (fs.statSync(filePath).isFile()) {
                    zip.addLocalFile(filePath, 'avatars');
                }
            });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `factory-reset-backup-ws${workspaceId}-${timestamp}.zip`;
        const zipBuffer = zip.toBuffer();

        // ── STEP 2: Delete operational data ────────────────────────────────
        await conn.beginTransaction();
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        for (const table of RESET_TABLES) {
            await conn.query(`DELETE FROM ${table} WHERE workspace_id = ?`, [workspaceId]);
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.commit();

        console.log(`[Factory Reset] ✅ Workspace ${workspaceId} berhasil direset oleh user ${req.user.id}`);

        // ── STEP 3: Send backup ZIP as download ─────────────────────────────
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(zipBuffer);

    } catch (error) {
        await conn.rollback().catch(() => { });
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => { });
        console.error('[Factory Reset] ERROR:', error);
        res.status(500).json({ message: 'Gagal melakukan factory reset.', error: error.message });
    } finally {
        conn.release();
    }
};
