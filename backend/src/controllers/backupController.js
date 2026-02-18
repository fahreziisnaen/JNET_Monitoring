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
    try {
        const backupData = {};

        // 1. Fetch all data from tables
        for (const table of TABLES) {
            const [rows] = await pool.query(`SELECT * FROM ${table}`);
            backupData[table] = rows;
        }

        // 2. Prepare ZIP
        const zip = new AdmZip();

        // Add database JSON
        zip.addFile('database_backup.json', Buffer.from(JSON.stringify(backupData, null, 2), 'utf8'));

        // 3. Add Avatars
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

        // 4. Generate and add KML (reusing logic or just exporting the whole network_assets table is enough as KML can be reconstructed)
        // However, for user convenience, we can add a .kml file too.
        // But since we have network_assets in JSON, it's safer for restore.

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `jnet-backup-${timestamp}.zip`;
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

    const conn = await pool.getConnection();
    try {
        const zip = new AdmZip(req.file.buffer);
        const zipEntries = zip.getEntries();

        // 1. Find and parse database_backup.json
        const dbEntry = zipEntries.find(e => e.entryName === 'database_backup.json');
        if (!dbEntry) {
            throw new Error('File database_backup.json tidak ditemukan dalam ZIP.');
        }

        const backupData = JSON.parse(dbEntry.getData().toString('utf8'));

        await conn.beginTransaction();
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        // 2. Truncate and Insert Data
        // Order matters for some tables if we don't use SET FOREIGN_KEY_CHECKS = 0, but since we do, it's easier.
        // However, it's good practice to clear them first.
        for (const table of TABLES) {
            await conn.query(`DELETE FROM ${table}`);

            const rows = backupData[table];
            if (rows && rows.length > 0) {
                const keys = Object.keys(rows[0]);
                const values = rows.map(row => keys.map(key => {
                    let value = row[key];
                    // Jika value adalah string ISO Date (2025-12-03T...Z), ubah ke format MySQL (YYYY-MM-DD HH:mm:ss)
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

        // 3. Restore Avatars
        const avatarDir = path.join(__dirname, '../../public/uploads/avatars');
        if (!fs.existsSync(avatarDir)) {
            fs.mkdirSync(avatarDir, { recursive: true });
        }

        zipEntries.forEach(entry => {
            if (entry.entryName.startsWith('avatars/') && !entry.isDirectory) {
                const fileName = path.basename(entry.entryName);
                if (fileName) {
                    fs.writeFileSync(path.join(avatarDir, fileName), entry.getData());
                }
            }
        });

        res.status(200).json({ message: 'Restore backup berhasil! Silakan login ulang jika diperlukan.' });

    } catch (error) {
        await conn.rollback();
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
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
    const workspaceId = req.user.workspace_id;
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
