const pool = require('../../config/database');
const { generateInvoicesForWorkspace, generateInvoiceForSubscription } = require('../services/billingService');
const { normalizeWa } = require('../utils/phone');
const { upsertFromClient } = require('../services/customerSyncService');
const withTransaction = require('../../utils/withTransaction');
const { createPaymentForInvoice } = require('../services/paymentService');
const { sendWhatsAppMessage, isWhatsAppConnected } = require('../../services/whatsappService');
const tripayService = require('../services/tripayService');
const isolirService = require('../services/isolirService');
const { removeSecretFromMonitoring } = require('../../services/secretDeletionService');
const ExcelJS = require('exceljs');

const MONTHS_ID = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function rupiah(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

async function syncSecretProfile(ws, customerId, packageId) {
    const [[row]] = await pool.query(
        `SELECT c.pppoe_secret_name, c.device_id, p.pppoe_profile
         FROM billing_customers c
         JOIN billing_packages p ON p.id = ? AND p.workspace_id = ?
         WHERE c.id = ? AND c.workspace_id = ?`,
        [packageId, ws, customerId, ws]
    );
    if (!row || !row.pppoe_secret_name) return { ok: false, message: 'Pelanggan tidak punya secret PPPoE, profil router dilewati.' };
    if (!row.pppoe_profile) return { ok: false, message: 'Paket tidak punya profil PPPoE, profil router tidak diubah.' };
    return isolirService.changeProfile({
        workspaceId: ws,
        deviceId: row.device_id || null,
        secretName: row.pppoe_secret_name,
        profile: row.pppoe_profile,
    });
}

async function applySubscriptionMikrotik(ws, subscriptionId, customerId, newStatus) {
    const [[row]] = await pool.query(
        `SELECT c.pppoe_secret_name, c.device_id, p.pppoe_profile, st.isolir_profile
         FROM billing_customers c
         LEFT JOIN billing_subscriptions s ON s.id = ?
         LEFT JOIN billing_packages p ON p.id = s.package_id
         LEFT JOIN billing_settings st ON st.workspace_id = c.workspace_id
         WHERE c.id = ? AND c.workspace_id = ?`,
        [subscriptionId, customerId, ws]
    );
    if (!row || !row.pppoe_secret_name) {
        return { ok: false, skipped: true, message: 'Pelanggan tidak punya secret PPPoE, router dilewati.' };
    }
    if (newStatus === 'active') {
        return isolirService.restoreCustomer({
            workspaceId: ws,
            deviceId: row.device_id || null,
            secretName: row.pppoe_secret_name,
            targetProfile: row.pppoe_profile || null,
        });
    }
    return isolirService.isolateCustomer({
        workspaceId: ws,
        deviceId: row.device_id || null,
        secretName: row.pppoe_secret_name,
        isolirProfile: row.isolir_profile || 'Isolir',
    });
}

function tanggalID(d) {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y || !m || !day || !MONTHS_ID[m]) return s;
    return `${day} ${MONTHS_ID[m]} ${y}`;
}

// Override ?workspaceId / workspace_id sudah divalidasi middleware protect
function resolveWorkspaceId(req) {
    const workspaceId = req.user.workspace_id;
    return (workspaceId == null || Number.isNaN(workspaceId)) ? null : workspaceId;
}

function paginationParams(req) {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();
    return { page, limit, offset, q };
}

exports.listPackages = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            'SELECT * FROM billing_packages WHERE workspace_id = ? ORDER BY price ASC',
            [ws]
        );
        return res.status(200).json({ packages: rows });
    } catch (e) {
        console.error('[Billing][Admin] listPackages:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil paket.' });
    }
};

exports.createPackage = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { name, description, price, speed_mbps, pppoe_profile, is_active } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: 'Nama paket wajib diisi.' });
        if (price == null || isNaN(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ message: 'Harga paket tidak valid.' });
        }
        const [result] = await pool.query(
            `INSERT INTO billing_packages (workspace_id, name, description, price, speed_mbps, pppoe_profile, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ws, name.trim(), description || null, Number(price), speed_mbps || null, pppoe_profile || null,
             is_active === false ? 0 : 1]
        );
        return res.status(201).json({ message: 'Paket dibuat.', id: result.insertId });
    } catch (e) {
        console.error('[Billing][Admin] createPackage:', e.message);
        return res.status(500).json({ message: 'Gagal membuat paket.' });
    }
};

exports.updatePackage = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { name, description, price, speed_mbps, pppoe_profile, is_active } = req.body;
        const [result] = await pool.query(
            `UPDATE billing_packages SET
                name = COALESCE(?, name),
                description = ?,
                price = COALESCE(?, price),
                speed_mbps = ?,
                pppoe_profile = ?,
                is_active = COALESCE(?, is_active)
             WHERE id = ? AND workspace_id = ?`,
            [name ?? null, description ?? null, price ?? null, speed_mbps ?? null, pppoe_profile ?? null,
             is_active == null ? null : (is_active ? 1 : 0), req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Paket tidak ditemukan.' });
        return res.status(200).json({ message: 'Paket diperbarui.' });
    } catch (e) {
        console.error('[Billing][Admin] updatePackage:', e.message);
        return res.status(500).json({ message: 'Gagal memperbarui paket.' });
    }
};

exports.deletePackage = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [result] = await pool.query(
            'DELETE FROM billing_packages WHERE id = ? AND workspace_id = ?',
            [req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Paket tidak ditemukan.' });
        return res.status(200).json({ message: 'Paket dihapus.' });
    } catch (e) {
        if (e.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ message: 'Paket masih dipakai langganan, tidak bisa dihapus.' });
        }
        console.error('[Billing][Admin] deletePackage:', e.message);
        return res.status(500).json({ message: 'Gagal menghapus paket.' });
    }
};

exports.listCustomers = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { page, limit, offset, q } = paginationParams(req);
        const filters = ['c.workspace_id = ?'];
        const params = [ws];
        const profileExpr = `(SELECT ps.profile FROM pppoe_secrets ps
                 WHERE ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
                   AND (c.device_id IS NULL OR ps.device_id = c.device_id) LIMIT 1)`;
        const effStatus = `CASE
                 WHEN s.id IS NULL THEN NULL
                 WHEN s.status = 'cancelled' THEN 'cancelled'
                 WHEN LOWER(${profileExpr}) = 'isolir' THEN 'suspended'
                 WHEN ${profileExpr} IS NULL THEN s.status
                 ELSE 'active' END`;
        if (q) {
            filters.push('(c.name LIKE ? OR c.whatsapp_number LIKE ? OR c.pppoe_secret_name LIKE ? OR c.ktp_number LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like, like);
        }
        if (req.query.package_id) { filters.push('s.package_id = ?'); params.push(Number(req.query.package_id)); }
        if (req.query.status) { filters.push(`${effStatus} = ?`); params.push(req.query.status); }
        const where = filters.join(' AND ');

        const subJoin = `LEFT JOIN billing_subscriptions s ON s.id = (
                 SELECT s2.id FROM billing_subscriptions s2
                 WHERE s2.customer_id = c.id
                 ORDER BY (s2.status = 'active') DESC, s2.created_at DESC LIMIT 1
             )`;

        const ORDER = {
            name: "(c.name IS NULL OR c.name = ''), c.name ASC, c.id DESC",
            recent: 'c.created_at DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) total FROM billing_customers c ${subJoin} WHERE ${where}`, params
        );
        const [rows] = await pool.query(
            `SELECT c.*, cl.client_name AS linked_client_name,
                    s.id AS subscription_id, ${effStatus} AS subscription_status,
                    s.package_id, DATE_FORMAT(s.start_date, '%Y-%m-%d') AS subscription_start_date,
                    s.due_day_of_month,
                    p.name AS package_name, p.price AS package_price
             FROM billing_customers c
             LEFT JOIN clients cl ON cl.id = c.client_id
             ${subJoin}
             LEFT JOIN billing_packages p ON p.id = s.package_id
             WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        return res.status(200).json({ customers: rows, total, page, limit });
    } catch (e) {
        console.error('[Billing][Admin] listCustomers:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pelanggan.' });
    }
};

exports.listImportableClients = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT c.id, c.client_name, c.whatsapp_number, c.pppoe_secret_name, c.device_id
             FROM clients c
             WHERE c.workspace_id = ?
               AND c.whatsapp_number IS NOT NULL AND c.whatsapp_number <> ''
               AND NOT EXISTS (
                   SELECT 1 FROM billing_customers b
                   WHERE b.workspace_id = c.workspace_id AND b.client_id = c.id
               )
             ORDER BY c.client_name ASC`,
            [ws]
        );
        return res.status(200).json({ clients: rows });
    } catch (e) {
        console.error('[Billing][Admin] listImportableClients:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil client yang bisa diimpor.' });
    }
};

exports.importClients = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { client_ids, all } = req.body;

        let sql = `SELECT c.id, c.client_name, c.whatsapp_number, c.pppoe_secret_name, c.device_id
                   FROM clients c
                   WHERE c.workspace_id = ?
                     AND c.whatsapp_number IS NOT NULL AND c.whatsapp_number <> ''
                     AND NOT EXISTS (
                         SELECT 1 FROM billing_customers b
                         WHERE b.workspace_id = c.workspace_id AND b.client_id = c.id
                     )`;
        const params = [ws];
        if (!all) {
            const ids = Array.isArray(client_ids) ? client_ids.map(Number).filter(Boolean) : [];
            if (ids.length === 0) return res.status(400).json({ message: 'Pilih minimal satu client, atau kirim all=true.' });
            sql += ` AND c.id IN (${ids.map(() => '?').join(',')})`;
            params.push(...ids);
        }
        const [clients] = await pool.query(sql, params);

        const summary = { total: clients.length, created: 0, relinked: 0, skipped: 0, skipped_no_wa: 0, skipped_dup_wa: 0, skipped_error: 0 };
        const skippedList = [];
        for (const c of clients) {
            const label = { client_name: c.client_name, whatsapp_number: c.whatsapp_number };
            try {
                const r = await upsertFromClient({
                    workspaceId: ws,
                    clientId: c.id,
                    name: c.client_name,
                    whatsapp: c.whatsapp_number,
                    secret: c.pppoe_secret_name,
                    deviceId: c.device_id,
                });
                if (r === 'created') summary.created++;
                else if (r === 'relinked') summary.relinked++;
                else if (r === 'skipped_no_wa') { summary.skipped++; summary.skipped_no_wa++; skippedList.push({ ...label, reason: 'no_wa' }); }
                else if (r === 'skipped_dup_wa') { summary.skipped++; summary.skipped_dup_wa++; skippedList.push({ ...label, reason: 'dup_wa' }); }
                else { summary.skipped++; skippedList.push({ ...label, reason: 'exists' }); }
            } catch (rowErr) {
                console.error('[Billing][Admin] importClients row:', rowErr.message);
                summary.skipped++;
                summary.skipped_error++;
                skippedList.push({ ...label, reason: 'error' });
            }
        }
        return res.status(200).json({ message: 'Import selesai.', summary, skipped: skippedList });
    } catch (e) {
        console.error('[Billing][Admin] importClients:', e.message);
        return res.status(500).json({ message: 'Gagal mengimpor client.' });
    }
};

exports.listAssignableCustomers = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT c.id, c.name, c.whatsapp_number, c.pppoe_secret_name,
                    ps.profile AS detected_profile,
                    pkg.id AS package_id, pkg.name AS package_name, pkg.price AS package_price
             FROM billing_customers c
             LEFT JOIN pppoe_secrets ps ON ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
             LEFT JOIN billing_packages pkg ON pkg.id = (
                 SELECT pk.id FROM billing_packages pk
                 WHERE pk.workspace_id = c.workspace_id AND LOWER(pk.pppoe_profile) = LOWER(ps.profile)
                 ORDER BY pk.id LIMIT 1
             )
             WHERE c.workspace_id = ?
               AND NOT EXISTS (
                   SELECT 1 FROM billing_subscriptions s
                   WHERE s.customer_id = c.id AND s.workspace_id = c.workspace_id
               )
             ORDER BY (pkg.id IS NULL), (c.name IS NULL OR c.name = ''), c.name ASC`,
            [ws]
        );
        return res.status(200).json({ customers: rows });
    } catch (e) {
        console.error('[Billing][Admin] listAssignableCustomers:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pelanggan tanpa paket.' });
    }
};

exports.assignPackages = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { customer_ids, all } = req.body;

        let sql = `SELECT c.id, c.name, c.whatsapp_number,
                          ps.profile AS detected_profile,
                          pkg.id AS package_id
                   FROM billing_customers c
                   LEFT JOIN pppoe_secrets ps ON ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
                   LEFT JOIN billing_packages pkg ON pkg.id = (
                       SELECT pk.id FROM billing_packages pk
                       WHERE pk.workspace_id = c.workspace_id AND LOWER(pk.pppoe_profile) = LOWER(ps.profile)
                       ORDER BY pk.id LIMIT 1
                   )
                   WHERE c.workspace_id = ?
                     AND NOT EXISTS (
                         SELECT 1 FROM billing_subscriptions s
                         WHERE s.customer_id = c.id AND s.workspace_id = c.workspace_id
                     )`;
        const params = [ws];
        if (!all) {
            const ids = Array.isArray(customer_ids) ? customer_ids.map(Number).filter(Boolean) : [];
            if (ids.length === 0) return res.status(400).json({ message: 'Pilih minimal satu pelanggan, atau kirim all=true.' });
            sql += ` AND c.id IN (${ids.map(() => '?').join(',')})`;
            params.push(...ids);
        }
        const [customers] = await pool.query(sql, params);

        const start = new Date().toISOString().slice(0, 10);
        const dueDay = Math.min(Math.max(new Date().getDate(), 1), 28);

        const summary = { total: customers.length, assigned: 0, skipped_no_profile: 0, skipped_no_match: 0, skipped_error: 0 };
        const skippedList = [];
        for (const c of customers) {
            const label = { name: c.name, whatsapp_number: c.whatsapp_number, profile: c.detected_profile };
            try {
                if (!c.detected_profile) {
                    summary.skipped_no_profile++;
                    skippedList.push({ ...label, reason: 'no_profile' });
                    continue;
                }
                if (!c.package_id) {
                    summary.skipped_no_match++;
                    skippedList.push({ ...label, reason: 'no_match' });
                    continue;
                }
                await pool.query(
                    `INSERT INTO billing_subscriptions (workspace_id, customer_id, package_id, status, start_date, due_day_of_month)
                     VALUES (?, ?, ?, 'active', ?, ?)`,
                    [ws, c.id, c.package_id, start, dueDay]
                );
                summary.assigned++;
            } catch (rowErr) {
                console.error('[Billing][Admin] assignPackages row:', rowErr.message);
                summary.skipped_error++;
                skippedList.push({ ...label, reason: 'error' });
            }
        }
        return res.status(200).json({ message: 'Pencocokan paket selesai.', summary, skipped: skippedList });
    } catch (e) {
        console.error('[Billing][Admin] assignPackages:', e.message);
        return res.status(500).json({ message: 'Gagal mencocokkan paket.' });
    }
};

exports.createCustomer = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        let { client_id, device_id, pppoe_secret_name, name, whatsapp_number, email, address } = req.body;
        if (!whatsapp_number || !String(whatsapp_number).trim()) {
            return res.status(400).json({ message: 'Nomor WhatsApp wajib diisi.' });
        }

        if (client_id) {
            const [cl] = await pool.query('SELECT * FROM clients WHERE id = ? AND workspace_id = ?', [client_id, ws]);
            if (cl.length === 0) return res.status(404).json({ message: 'Client (lokasi) tidak ditemukan di workspace ini.' });
            pppoe_secret_name = pppoe_secret_name || cl[0].pppoe_secret_name;
            device_id = device_id || cl[0].device_id;
            name = name || cl[0].client_name;
        }

        const [result] = await pool.query(
            `INSERT INTO billing_customers
                (workspace_id, client_id, device_id, pppoe_secret_name, name, whatsapp_number, email, address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ws, client_id || null, device_id || null, pppoe_secret_name || null,
             name || null, normalizeWa(whatsapp_number), email || null, address || null]
        );
        return res.status(201).json({ message: 'Pelanggan dibuat.', id: result.insertId });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Nomor WhatsApp sudah terdaftar di workspace ini.' });
        }
        console.error('[Billing][Admin] createCustomer:', e.message);
        return res.status(500).json({ message: 'Gagal membuat pelanggan.' });
    }
};

exports.updateCustomer = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { name, whatsapp_number, email, address, status, pppoe_secret_name, device_id, client_id, ktp_number } = req.body;
        const hasSecret = Object.prototype.hasOwnProperty.call(req.body, 'pppoe_secret_name');
        const [result] = await pool.query(
            `UPDATE billing_customers SET
                name = COALESCE(?, name),
                whatsapp_number = COALESCE(?, whatsapp_number),
                email = ?, address = ?,
                ktp_number = COALESCE(?, ktp_number),
                status = COALESCE(?, status),
                pppoe_secret_name = IF(?, ?, pppoe_secret_name),
                device_id = COALESCE(?, device_id),
                client_id = COALESCE(?, client_id)
             WHERE id = ? AND workspace_id = ?`,
            [name ?? null, whatsapp_number ? normalizeWa(whatsapp_number) : null, email ?? null, address ?? null, ktp_number ?? null, status ?? null,
             hasSecret ? 1 : 0, hasSecret ? (pppoe_secret_name ?? null) : null, device_id ?? null, client_id ?? null, req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });
        return res.status(200).json({ message: 'Pelanggan diperbarui.' });
    } catch (e) {
        console.error('[Billing][Admin] updateCustomer:', e.message);
        return res.status(500).json({ message: 'Gagal memperbarui pelanggan.' });
    }
};

exports.getCustomerDetail = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT c.*,
                    cl.latitude, cl.longitude, cl.odp_asset_id, cl.photo_url, cl.client_name AS linked_client_name
             FROM billing_customers c
             LEFT JOIN clients cl ON cl.id = c.client_id
             WHERE c.id = ? AND c.workspace_id = ?`,
            [req.params.id, ws]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });

        const [subs] = await pool.query(
            `SELECT id, package_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, due_day_of_month, status
             FROM billing_subscriptions
             WHERE customer_id = ? AND workspace_id = ?
             ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
            [req.params.id, ws]
        );
        return res.status(200).json({ customer: rows[0], subscription: subs[0] || null });
    } catch (e) {
        console.error('[Billing][Admin] getCustomerDetail:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil detail pelanggan.' });
    }
};

exports.deleteCustomer = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [[cust]] = await pool.query(
            'SELECT pppoe_secret_name, device_id FROM billing_customers WHERE id = ? AND workspace_id = ?',
            [req.params.id, ws]
        );
        if (!cust) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });

        await pool.query('DELETE FROM billing_customers WHERE id = ? AND workspace_id = ?', [req.params.id, ws]);

        if (cust.pppoe_secret_name) {
            removeSecretFromMonitoring({
                workspaceId: ws,
                secretName: cust.pppoe_secret_name,
                deviceId: cust.device_id || null,
            }).catch((syncErr) => console.error('[Billing][Admin] deleteCustomer sync secret:', syncErr.message));
        }
        return res.status(200).json({ message: 'Pelanggan dihapus.' });
    } catch (e) {
        console.error('[Billing][Admin] deleteCustomer:', e.message);
        return res.status(500).json({ message: 'Gagal menghapus pelanggan.' });
    }
};

exports.listSubscriptions = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { page, limit, offset, q } = paginationParams(req);
        const filters = ['s.workspace_id = ?'];
        const params = [ws];
        if (q) {
            filters.push('(c.name LIKE ? OR c.whatsapp_number LIKE ? OR p.name LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }
        const where = filters.join(' AND ');
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) total
             FROM billing_subscriptions s
             JOIN billing_customers c ON c.id = s.customer_id
             JOIN billing_packages p ON p.id = s.package_id
             WHERE ${where}`,
            params
        );
        const [rows] = await pool.query(
            `SELECT s.*,
                    DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(s.next_due_date, '%Y-%m-%d') AS next_due_date,
                    c.name AS customer_name, c.whatsapp_number, p.name AS package_name, p.price
             FROM billing_subscriptions s
             JOIN billing_customers c ON c.id = s.customer_id
             JOIN billing_packages p ON p.id = s.package_id
             WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        return res.status(200).json({ subscriptions: rows, total, page, limit });
    } catch (e) {
        console.error('[Billing][Admin] listSubscriptions:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil langganan.' });
    }
};

exports.createSubscription = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { customer_id, package_id, start_date, due_day_of_month } = req.body;
        if (!customer_id || !package_id) {
            return res.status(400).json({ message: 'customer_id dan package_id wajib diisi.' });
        }
        const [c] = await pool.query('SELECT id FROM billing_customers WHERE id = ? AND workspace_id = ?', [customer_id, ws]);
        const [p] = await pool.query('SELECT id FROM billing_packages WHERE id = ? AND workspace_id = ?', [package_id, ws]);
        if (c.length === 0) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });
        if (p.length === 0) return res.status(404).json({ message: 'Paket tidak ditemukan.' });

        const dueDay = Math.min(Math.max(parseInt(due_day_of_month) || 1, 1), 28);
        const start = start_date || new Date().toISOString().slice(0, 10);
        const startYear = parseInt(start.slice(0, 4), 10);
        const startMonth = parseInt(start.slice(5, 7), 10);

        const subscriptionId = await withTransaction(async (conn) => {
            const [result] = await conn.query(
                `INSERT INTO billing_subscriptions (workspace_id, customer_id, package_id, status, start_date, due_day_of_month)
                 VALUES (?, ?, ?, 'active', ?, ?)`,
                [ws, customer_id, package_id, start, dueDay]
            );
            const subId = result.insertId;

            const inv = await generateInvoiceForSubscription(
                { id: subId, workspace_id: ws, customer_id, package_id, due_day_of_month: dueDay, status: 'active' },
                startYear, startMonth, conn
            );
            if (inv.created) {
                await conn.query(
                    "UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
                    [start, inv.invoiceId]
                );
                const [amtRows] = await conn.query('SELECT amount FROM billing_invoices WHERE id = ?', [inv.invoiceId]);
                const amount = amtRows[0] ? amtRows[0].amount : 0;
                await conn.query(
                    `INSERT INTO billing_payments (workspace_id, invoice_id, provider, merchant_ref, payment_method, amount, status, paid_at)
                     VALUES (?, ?, 'manual', ?, 'cash', ?, 'paid', ?)`,
                    [ws, inv.invoiceId, `CASH-INV${inv.invoiceId}`, amount, start]
                );
            }
            return subId;
        });

        let profileSync = null;
        try { profileSync = await syncSecretProfile(ws, customer_id, Number(package_id)); }
        catch (e) { profileSync = { ok: false, message: e.message }; }

        return res.status(201).json({ message: 'Langganan dibuat.', id: subscriptionId, profile_sync: profileSync });
    } catch (e) {
        console.error('[Billing][Admin] createSubscription:', e.message);
        return res.status(500).json({ message: 'Gagal membuat langganan.' });
    }
};

exports.updateSubscription = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { package_id, status, due_day_of_month, start_date } = req.body;
        const [[sub]] = await pool.query(
            'SELECT customer_id, package_id, status FROM billing_subscriptions WHERE id = ? AND workspace_id = ?',
            [req.params.id, ws]
        );
        if (!sub) return res.status(404).json({ message: 'Langganan tidak ditemukan.' });

        const [result] = await pool.query(
            `UPDATE billing_subscriptions SET
                package_id = COALESCE(?, package_id),
                status = COALESCE(?, status),
                due_day_of_month = COALESCE(?, due_day_of_month),
                start_date = COALESCE(?, start_date)
             WHERE id = ? AND workspace_id = ?`,
            [package_id ?? null, status ?? null, due_day_of_month ?? null, start_date ?? null, req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Langganan tidak ditemukan.' });

        let profileSync = null;
        let isolir = null;
        const newPkg = package_id != null ? Number(package_id) : null;
        const pkgChanged = newPkg && newPkg !== sub.package_id;
        const statusChanged = status != null && status !== sub.status;
        const effectiveStatus = status || sub.status;

        if (statusChanged && (status === 'active' || status === 'suspended')) {
            try { isolir = await applySubscriptionMikrotik(ws, req.params.id, sub.customer_id, status); }
            catch (e) { isolir = { ok: false, message: e.message }; }
        } else if (pkgChanged && effectiveStatus === 'active') {
            try { profileSync = await syncSecretProfile(ws, sub.customer_id, newPkg); }
            catch (e) { profileSync = { ok: false, message: e.message }; }
        }

        return res.status(200).json({ message: 'Langganan diperbarui.', profile_sync: profileSync, isolir });
    } catch (e) {
        console.error('[Billing][Admin] updateSubscription:', e.message);
        return res.status(500).json({ message: 'Gagal memperbarui langganan.' });
    }
};

exports.listInvoices = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { page, limit, offset, q } = paginationParams(req);
        const filters = ['i.workspace_id = ?'];
        const params = [ws];
        if (req.query.status) { filters.push('i.status = ?'); params.push(req.query.status); }
        if (req.query.year) { filters.push('i.period_year = ?'); params.push(parseInt(req.query.year)); }
        if (req.query.month) { filters.push('i.period_month = ?'); params.push(parseInt(req.query.month)); }
        if (q) {
            filters.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.whatsapp_number LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }
        const where = filters.join(' AND ');
        const ORDER = {
            recent: 'i.period_year DESC, i.period_month DESC, i.id DESC',
            due: 'i.due_date ASC, i.id DESC',
            amount: 'i.amount DESC, i.id DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) total
             FROM billing_invoices i
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where}`,
            params
        );
        const [rows] = await pool.query(
            `SELECT i.*,
                    DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
                    c.name AS customer_name, c.whatsapp_number
             FROM billing_invoices i
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        return res.status(200).json({ invoices: rows, total, page, limit });
    } catch (e) {
        console.error('[Billing][Admin] listInvoices:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil invoice.' });
    }
};

exports.listPayments = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { page, limit, offset, q } = paginationParams(req);
        const filters = ['p.workspace_id = ?'];
        const params = [ws];
        if (req.query.status) { filters.push('p.status = ?'); params.push(req.query.status); }
        if (req.query.method) { filters.push('p.payment_method = ?'); params.push(req.query.method); }
        if (q) {
            filters.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.whatsapp_number LIKE ? OR p.provider_ref LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like, like);
        }
        const where = filters.join(' AND ');
        const ORDER = {
            recent: '(p.paid_at IS NULL), p.paid_at DESC, p.id DESC',
            amount: 'p.amount DESC, p.id DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) total
             FROM billing_payments p
             JOIN billing_invoices i ON i.id = p.invoice_id
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where}`,
            params
        );
        const [rows] = await pool.query(
            `SELECT p.id, p.invoice_id, p.provider, p.payment_method, p.amount, p.fee,
                    p.status, p.provider_ref, p.paid_at, p.created_at,
                    i.invoice_number, i.period_year, i.period_month,
                    c.name AS customer_name, c.whatsapp_number
             FROM billing_payments p
             JOIN billing_invoices i ON i.id = p.invoice_id
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        return res.status(200).json({ payments: rows, total, page, limit });
    } catch (e) {
        console.error('[Billing][Admin] listPayments:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pembayaran.' });
    }
};

exports.paymentsSummary = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [[row]] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) AS total_revenue,
                COALESCE(SUM(CASE WHEN p.status = 'paid'
                    AND YEAR(p.paid_at) = YEAR(CURDATE())
                    AND MONTH(p.paid_at) = MONTH(CURDATE()) THEN p.amount ELSE 0 END), 0) AS month_revenue,
                COUNT(CASE WHEN p.status = 'paid'
                    AND YEAR(p.paid_at) = YEAR(CURDATE())
                    AND MONTH(p.paid_at) = MONTH(CURDATE()) THEN 1 END) AS month_count,
                COUNT(CASE WHEN p.status = 'paid' THEN 1 END) AS total_count
             FROM billing_payments p
             WHERE p.workspace_id = ?`,
            [ws]
        );
        return res.status(200).json({
            total_revenue: Number(row.total_revenue || 0),
            month_revenue: Number(row.month_revenue || 0),
            month_count: Number(row.month_count || 0),
            total_count: Number(row.total_count || 0),
        });
    } catch (e) {
        console.error('[Billing][Admin] paymentsSummary:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil ringkasan pendapatan.' });
    }
};

const SUB_STATUS_LABEL = { active: 'Aktif', suspended: 'Isolir', cancelled: 'Berhenti' };
const CUST_STATUS_LABEL = { active: 'Aktif', inactive: 'Nonaktif', suspended: 'Isolir' };
const INVOICE_STATUS_LABEL = { unpaid: 'Belum Bayar', paid: 'Lunas', overdue: 'Terlambat', void: 'Batal' };
const PAYMENT_STATUS_LABEL = { paid: 'Lunas', pending: 'Menunggu', failed: 'Gagal', expired: 'Kadaluarsa', refunded: 'Refund' };

async function sendWorkbook(res, filename, sheetName, columns, rows) {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName);
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    rows.forEach((r) => sheet.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
}

exports.exportCustomers = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { q } = paginationParams(req);
        const filters = ['c.workspace_id = ?'];
        const params = [ws];
        const profileExpr = `(SELECT ps.profile FROM pppoe_secrets ps
                 WHERE ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
                   AND (c.device_id IS NULL OR ps.device_id = c.device_id) LIMIT 1)`;
        const effStatus = `CASE
                 WHEN s.id IS NULL THEN NULL
                 WHEN s.status = 'cancelled' THEN 'cancelled'
                 WHEN LOWER(${profileExpr}) = 'isolir' THEN 'suspended'
                 WHEN ${profileExpr} IS NULL THEN s.status
                 ELSE 'active' END`;
        if (q) {
            filters.push('(c.name LIKE ? OR c.whatsapp_number LIKE ? OR c.pppoe_secret_name LIKE ? OR c.ktp_number LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like, like);
        }
        if (req.query.package_id) { filters.push('s.package_id = ?'); params.push(Number(req.query.package_id)); }
        if (req.query.status) { filters.push(`${effStatus} = ?`); params.push(req.query.status); }
        const where = filters.join(' AND ');
        const subJoin = `LEFT JOIN billing_subscriptions s ON s.id = (
                 SELECT s2.id FROM billing_subscriptions s2
                 WHERE s2.customer_id = c.id
                 ORDER BY (s2.status = 'active') DESC, s2.created_at DESC LIMIT 1
             )`;
        const ORDER = {
            name: "(c.name IS NULL OR c.name = ''), c.name ASC, c.id DESC",
            recent: 'c.created_at DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;
        const [rows] = await pool.query(
            `SELECT c.name, c.whatsapp_number, c.ktp_number, c.pppoe_secret_name, c.status,
                    ${effStatus} AS subscription_status,
                    DATE_FORMAT(s.start_date, '%Y-%m-%d') AS subscription_start_date,
                    p.name AS package_name, p.price AS package_price
             FROM billing_customers c
             ${subJoin}
             LEFT JOIN billing_packages p ON p.id = s.package_id
             WHERE ${where} ORDER BY ${orderBy}`,
            params
        );
        const columns = [
            { header: 'Nama', key: 'name', width: 24 },
            { header: 'WhatsApp', key: 'wa', width: 18 },
            { header: 'No. KTP', key: 'ktp', width: 20 },
            { header: 'Secret PPPoE', key: 'secret', width: 18 },
            { header: 'Paket', key: 'package', width: 20 },
            { header: 'Harga/bln', key: 'price', width: 14, style: { numFmt: '#,##0' } },
            { header: 'Status Langganan', key: 'sub_status', width: 16 },
            { header: 'Mulai Langganan', key: 'start', width: 16 },
            { header: 'Status Pelanggan', key: 'cust_status', width: 16 },
        ];
        const data = rows.map((r) => ({
            name: r.name || '',
            wa: r.whatsapp_number || '',
            ktp: r.ktp_number || '',
            secret: r.pppoe_secret_name || '',
            package: r.package_name || '',
            price: r.package_price != null ? Number(r.package_price) : null,
            sub_status: r.subscription_status ? (SUB_STATUS_LABEL[r.subscription_status] || r.subscription_status) : '',
            start: r.subscription_start_date ? tanggalID(r.subscription_start_date) : '',
            cust_status: CUST_STATUS_LABEL[r.status] || r.status || '',
        }));
        return sendWorkbook(res, `pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Pelanggan', columns, data);
    } catch (e) {
        console.error('[Billing][Admin] exportCustomers:', e.message);
        return res.status(500).json({ message: 'Gagal mengekspor pelanggan.' });
    }
};

exports.exportInvoices = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { q } = paginationParams(req);
        const filters = ['i.workspace_id = ?'];
        const params = [ws];
        if (req.query.status) { filters.push('i.status = ?'); params.push(req.query.status); }
        if (req.query.year) { filters.push('i.period_year = ?'); params.push(parseInt(req.query.year)); }
        if (req.query.month) { filters.push('i.period_month = ?'); params.push(parseInt(req.query.month)); }
        if (q) {
            filters.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.whatsapp_number LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }
        const where = filters.join(' AND ');
        const ORDER = {
            recent: 'i.period_year DESC, i.period_month DESC, i.id DESC',
            due: 'i.due_date ASC, i.id DESC',
            amount: 'i.amount DESC, i.id DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;
        const [rows] = await pool.query(
            `SELECT i.invoice_number, i.period_year, i.period_month, i.amount, i.status,
                    DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
                    c.name AS customer_name, c.whatsapp_number
             FROM billing_invoices i
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where} ORDER BY ${orderBy}`,
            params
        );
        const columns = [
            { header: 'No. Invoice', key: 'no', width: 22 },
            { header: 'Pelanggan', key: 'name', width: 24 },
            { header: 'WhatsApp', key: 'wa', width: 18 },
            { header: 'Periode', key: 'period', width: 18 },
            { header: 'Jumlah', key: 'amount', width: 14, style: { numFmt: '#,##0' } },
            { header: 'Jatuh Tempo', key: 'due', width: 16 },
            { header: 'Status', key: 'status', width: 14 },
        ];
        const data = rows.map((r) => ({
            no: r.invoice_number || '',
            name: r.customer_name || '',
            wa: r.whatsapp_number || '',
            period: `${MONTHS_ID[r.period_month] || r.period_month} ${r.period_year}`,
            amount: r.amount != null ? Number(r.amount) : null,
            due: r.due_date ? tanggalID(r.due_date) : '',
            status: INVOICE_STATUS_LABEL[r.status] || r.status || '',
        }));
        return sendWorkbook(res, `invoice-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Invoice', columns, data);
    } catch (e) {
        console.error('[Billing][Admin] exportInvoices:', e.message);
        return res.status(500).json({ message: 'Gagal mengekspor invoice.' });
    }
};

exports.exportPayments = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { q } = paginationParams(req);
        const filters = ['p.workspace_id = ?'];
        const params = [ws];
        if (req.query.status) { filters.push('p.status = ?'); params.push(req.query.status); }
        if (req.query.method) { filters.push('p.payment_method = ?'); params.push(req.query.method); }
        if (q) {
            filters.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.whatsapp_number LIKE ? OR p.provider_ref LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like, like);
        }
        const where = filters.join(' AND ');
        const ORDER = {
            recent: '(p.paid_at IS NULL), p.paid_at DESC, p.id DESC',
            amount: 'p.amount DESC, p.id DESC',
        };
        const orderBy = ORDER[req.query.sort] || ORDER.recent;
        const [rows] = await pool.query(
            `SELECT p.payment_method, p.provider, p.amount, p.status,
                    DATE_FORMAT(p.paid_at, '%Y-%m-%d %H:%i') AS paid_at,
                    i.invoice_number, i.period_year, i.period_month,
                    c.name AS customer_name, c.whatsapp_number
             FROM billing_payments p
             JOIN billing_invoices i ON i.id = p.invoice_id
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${where} ORDER BY ${orderBy}`,
            params
        );
        const methodLabel = (r) => (r.payment_method === 'cash' ? 'Tunai' : (r.payment_method || r.provider || ''));
        const columns = [
            { header: 'Tanggal Bayar', key: 'paid', width: 18 },
            { header: 'Pelanggan', key: 'name', width: 24 },
            { header: 'WhatsApp', key: 'wa', width: 18 },
            { header: 'No. Invoice', key: 'no', width: 22 },
            { header: 'Periode', key: 'period', width: 18 },
            { header: 'Metode', key: 'method', width: 14 },
            { header: 'Jumlah', key: 'amount', width: 14, style: { numFmt: '#,##0' } },
            { header: 'Status', key: 'status', width: 14 },
        ];
        const data = rows.map((r) => ({
            paid: r.paid_at || '',
            name: r.customer_name || '',
            wa: r.whatsapp_number || '',
            no: r.invoice_number || '',
            period: `${MONTHS_ID[r.period_month] || r.period_month} ${r.period_year}`,
            method: methodLabel(r),
            amount: r.amount != null ? Number(r.amount) : null,
            status: PAYMENT_STATUS_LABEL[r.status] || r.status || '',
        }));
        return sendWorkbook(res, `pembayaran-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Pembayaran', columns, data);
    } catch (e) {
        console.error('[Billing][Admin] exportPayments:', e.message);
        return res.status(500).json({ message: 'Gagal mengekspor pembayaran.' });
    }
};

exports.sendInvoiceWa = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT i.*, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
                    c.name AS customer_name, c.whatsapp_number
             FROM billing_invoices i
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE i.id = ? AND i.workspace_id = ?`,
            [req.params.id, ws]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Invoice tidak ditemukan.' });
        const invoice = rows[0];
        if (invoice.status === 'paid') return res.status(400).json({ message: 'Invoice sudah lunas.' });
        if (!invoice.whatsapp_number) return res.status(400).json({ message: 'Pelanggan tidak punya nomor WhatsApp.' });

        let result;
        try {
            result = await createPaymentForInvoice(invoice, { method: req.body.method });
        } catch (gwErr) {
            console.error('[Billing][Admin] sendInvoiceWa gateway:', gwErr.message);
            return res.status(422).json({ message: `Gagal membuat link pembayaran: ${gwErr.message}` });
        }

        const checkoutUrl = result.payment.checkout_url;
        if (!checkoutUrl) {
            return res.status(422).json({ message: 'Gateway tidak mengembalikan link pembayaran.' });
        }

        const periode = `${MONTHS_ID[invoice.period_month]} ${invoice.period_year}`;
        const message =
            `Halo ${invoice.customer_name || ''},\n\n` +
            `Berikut tagihan internet Anda:\n` +
            `No. Invoice: ${invoice.invoice_number}\n` +
            `Periode: ${periode}\n` +
            `Jumlah: ${rupiah(invoice.amount)}\n` +
            `Jatuh tempo: ${tanggalID(invoice.due_date)}\n\n` +
            `Silakan lakukan pembayaran melalui link berikut:\n${checkoutUrl}\n\n` +
            `Terima kasih.`;

        const target = normalizeWa(invoice.whatsapp_number);
        const waConnected = isWhatsAppConnected();
        let waSent = false;
        if (waConnected) {
            // Masuk antrean anti-ban; dikirim bertahap dengan jeda, tidak ditunggu di request ini
            waSent = await sendWhatsAppMessage(target, message, { category: 'billing' });
        }

        let waMessage;
        if (waSent) waMessage = 'Tagihan masuk antrean WhatsApp dan terkirim bertahap dalam beberapa menit.';
        else if (!waConnected) waMessage = 'Link dibuat, tapi WhatsApp bot belum terhubung. Salin link manual.';
        else waMessage = 'Link dibuat, tapi antrean WhatsApp menolak pesan (bot logout/diblokir atau antrean penuh). Salin link manual.';

        return res.status(200).json({
            message: waMessage,
            wa_sent: waSent,
            wa_connected: waConnected,
            checkout_url: checkoutUrl,
            reused: result.reused,
            simulated: result.simulated,
        });
    } catch (e) {
        console.error('[Billing][Admin] sendInvoiceWa:', e.message);
        return res.status(500).json({ message: 'Gagal mengirim tagihan.' });
    }
};

exports.payInvoiceCash = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            'SELECT * FROM billing_invoices WHERE id = ? AND workspace_id = ?',
            [req.params.id, ws]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Invoice tidak ditemukan.' });
        const invoice = rows[0];
        if (invoice.status === 'paid') return res.status(400).json({ message: 'Invoice sudah lunas.' });

        const now = new Date();
        await withTransaction(async (conn) => {
            await conn.query(
                "UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
                [now, invoice.id]
            );
            await conn.query(
                `INSERT INTO billing_payments (workspace_id, invoice_id, provider, merchant_ref, payment_method, amount, status, paid_at)
                 VALUES (?, ?, 'manual', ?, 'cash', ?, 'paid', ?)`,
                [ws, invoice.id, `CASH-INV${invoice.id}-${now.getTime()}`, invoice.amount, now]
            );
        });

        try {
            const [custRows] = await pool.query(
                'SELECT bc.device_id, bc.pppoe_secret_name, p.pppoe_profile FROM billing_customers bc ' +
                'LEFT JOIN billing_subscriptions s ON s.id = ? ' +
                'LEFT JOIN billing_packages p ON p.id = s.package_id ' +
                'WHERE bc.id = ?',
                [invoice.subscription_id, invoice.customer_id]
            );
            const c = custRows[0];
            if (c && c.pppoe_secret_name) {
                await isolirService.restoreCustomer({
                    workspaceId: ws,
                    deviceId: c.device_id,
                    secretName: c.pppoe_secret_name,
                    targetProfile: c.pppoe_profile || null,
                });
            }
        } catch (e) {
            console.error('[Billing][Admin] payInvoiceCash restore gagal:', e.message);
        }

        return res.status(200).json({ message: 'Pembayaran tunai dicatat. Invoice lunas.' });
    } catch (e) {
        console.error('[Billing][Admin] payInvoiceCash:', e.message);
        return res.status(500).json({ message: 'Gagal mencatat pembayaran tunai.' });
    }
};

exports.generateInvoices = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { year, month } = req.body;
        const summary = await generateInvoicesForWorkspace(ws, year ? parseInt(year) : null, month ? parseInt(month) : null);
        return res.status(200).json({ message: 'Generate invoice selesai.', summary });
    } catch (e) {
        console.error('[Billing][Admin] generateInvoices:', e.message);
        return res.status(500).json({ message: 'Gagal generate invoice.' });
    }
};

exports.getSettings = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT workspace_id, invoice_gen_day, reminder_days_before, grace_days,
                    auto_isolir_enabled, isolir_profile, created_at, updated_at
             FROM billing_settings WHERE workspace_id = ?`,
            [ws]
        );
        const cfg = tripayService.getConfig();
        const gateway = { configured: tripayService.isConfigured(), mode: cfg.mode };
        return res.status(200).json({ settings: rows[0] || null, gateway });
    } catch (e) {
        console.error('[Billing][Admin] getSettings:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pengaturan.' });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const {
            invoice_gen_day, reminder_days_before, grace_days, auto_isolir_enabled, isolir_profile,
        } = req.body;

        await pool.query(
            `INSERT INTO billing_settings
                (workspace_id, invoice_gen_day, reminder_days_before, grace_days, auto_isolir_enabled, isolir_profile)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                invoice_gen_day = COALESCE(VALUES(invoice_gen_day), invoice_gen_day),
                reminder_days_before = COALESCE(VALUES(reminder_days_before), reminder_days_before),
                grace_days = COALESCE(VALUES(grace_days), grace_days),
                auto_isolir_enabled = COALESCE(VALUES(auto_isolir_enabled), auto_isolir_enabled),
                isolir_profile = COALESCE(VALUES(isolir_profile), isolir_profile)`,
            [ws, invoice_gen_day ?? 1, reminder_days_before ?? 3, grace_days ?? 3,
             auto_isolir_enabled == null ? 0 : (auto_isolir_enabled ? 1 : 0), isolir_profile ?? 'Isolir']
        );
        return res.status(200).json({ message: 'Pengaturan billing disimpan.' });
    } catch (e) {
        console.error('[Billing][Admin] updateSettings:', e.message);
        return res.status(500).json({ message: 'Gagal menyimpan pengaturan.' });
    }
};
