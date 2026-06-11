/**
 * billingAdminController.js
 * Endpoint admin (di belakang protect + authorizeAdmin) untuk mengelola
 * paket, pelanggan, langganan, invoice, dan pengaturan billing.
 * Workspace-scoped: memakai req.user.workspace_id dengan override superadmin/NOC.
 */
const pool = require('../../config/database');
const { generateInvoicesForWorkspace } = require('../services/billingService');

/** Tentukan workspace target (dukung override admin/noc/superadmin via query/body). */
function resolveWorkspaceId(req) {
    let workspaceId = req.user.workspace_id;
    const isSuper = req.user.is_super_admin === 1 || req.user.is_super_admin === true;
    const override = req.query.workspaceId || req.body.workspace_id;
    if (override && (req.user.role === 'admin' || req.user.role === 'noc' || isSuper)) {
        workspaceId = parseInt(override);
    }
    return workspaceId;
}

// ============================ PAKET ============================

// GET /api/billing/admin/packages
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

// POST /api/billing/admin/packages
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

// PUT /api/billing/admin/packages/:id
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

// DELETE /api/billing/admin/packages/:id
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
        // FK RESTRICT: paket masih dipakai langganan
        if (e.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ message: 'Paket masih dipakai langganan, tidak bisa dihapus.' });
        }
        console.error('[Billing][Admin] deletePackage:', e.message);
        return res.status(500).json({ message: 'Gagal menghapus paket.' });
    }
};

// ========================== PELANGGAN ==========================

// GET /api/billing/admin/customers
exports.listCustomers = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT c.*, cl.client_name AS linked_client_name
             FROM billing_customers c
             LEFT JOIN clients cl ON cl.id = c.client_id
             WHERE c.workspace_id = ? ORDER BY c.created_at DESC`,
            [ws]
        );
        return res.status(200).json({ customers: rows });
    } catch (e) {
        console.error('[Billing][Admin] listCustomers:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pelanggan.' });
    }
};

// POST /api/billing/admin/customers
// Bisa otomatis menautkan ke `clients` existing berdasarkan client_id atau pppoe_secret_name.
exports.createCustomer = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        let { client_id, device_id, pppoe_secret_name, name, whatsapp_number, email, address } = req.body;
        if (!whatsapp_number || !String(whatsapp_number).trim()) {
            return res.status(400).json({ message: 'Nomor WhatsApp wajib diisi.' });
        }

        // Jika ditautkan ke client existing, ambil data turunan dari tabel clients.
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
             name || null, String(whatsapp_number).trim(), email || null, address || null]
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

// PUT /api/billing/admin/customers/:id
exports.updateCustomer = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { name, whatsapp_number, email, address, status, pppoe_secret_name, device_id, client_id } = req.body;
        const [result] = await pool.query(
            `UPDATE billing_customers SET
                name = COALESCE(?, name),
                whatsapp_number = COALESCE(?, whatsapp_number),
                email = ?, address = ?,
                status = COALESCE(?, status),
                pppoe_secret_name = COALESCE(?, pppoe_secret_name),
                device_id = COALESCE(?, device_id),
                client_id = COALESCE(?, client_id)
             WHERE id = ? AND workspace_id = ?`,
            [name ?? null, whatsapp_number ?? null, email ?? null, address ?? null, status ?? null,
             pppoe_secret_name ?? null, device_id ?? null, client_id ?? null, req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });
        return res.status(200).json({ message: 'Pelanggan diperbarui.' });
    } catch (e) {
        console.error('[Billing][Admin] updateCustomer:', e.message);
        return res.status(500).json({ message: 'Gagal memperbarui pelanggan.' });
    }
};

// ========================== LANGGANAN ==========================

// GET /api/billing/admin/subscriptions
exports.listSubscriptions = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query(
            `SELECT s.*, c.name AS customer_name, c.whatsapp_number, p.name AS package_name, p.price
             FROM billing_subscriptions s
             JOIN billing_customers c ON c.id = s.customer_id
             JOIN billing_packages p ON p.id = s.package_id
             WHERE s.workspace_id = ? ORDER BY s.created_at DESC`,
            [ws]
        );
        return res.status(200).json({ subscriptions: rows });
    } catch (e) {
        console.error('[Billing][Admin] listSubscriptions:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil langganan.' });
    }
};

// POST /api/billing/admin/subscriptions
exports.createSubscription = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { customer_id, package_id, start_date, due_day_of_month } = req.body;
        if (!customer_id || !package_id) {
            return res.status(400).json({ message: 'customer_id dan package_id wajib diisi.' });
        }
        // Validasi keduanya milik workspace ini.
        const [c] = await pool.query('SELECT id FROM billing_customers WHERE id = ? AND workspace_id = ?', [customer_id, ws]);
        const [p] = await pool.query('SELECT id FROM billing_packages WHERE id = ? AND workspace_id = ?', [package_id, ws]);
        if (c.length === 0) return res.status(404).json({ message: 'Pelanggan tidak ditemukan.' });
        if (p.length === 0) return res.status(404).json({ message: 'Paket tidak ditemukan.' });

        const dueDay = Math.min(Math.max(parseInt(due_day_of_month) || 1, 1), 28);
        const start = start_date || new Date().toISOString().slice(0, 10);

        const [result] = await pool.query(
            `INSERT INTO billing_subscriptions (workspace_id, customer_id, package_id, status, start_date, due_day_of_month)
             VALUES (?, ?, ?, 'active', ?, ?)`,
            [ws, customer_id, package_id, start, dueDay]
        );
        return res.status(201).json({ message: 'Langganan dibuat.', id: result.insertId });
    } catch (e) {
        console.error('[Billing][Admin] createSubscription:', e.message);
        return res.status(500).json({ message: 'Gagal membuat langganan.' });
    }
};

// PUT /api/billing/admin/subscriptions/:id
exports.updateSubscription = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const { package_id, status, due_day_of_month } = req.body;
        const [result] = await pool.query(
            `UPDATE billing_subscriptions SET
                package_id = COALESCE(?, package_id),
                status = COALESCE(?, status),
                due_day_of_month = COALESCE(?, due_day_of_month)
             WHERE id = ? AND workspace_id = ?`,
            [package_id ?? null, status ?? null, due_day_of_month ?? null, req.params.id, ws]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Langganan tidak ditemukan.' });
        return res.status(200).json({ message: 'Langganan diperbarui.' });
    } catch (e) {
        console.error('[Billing][Admin] updateSubscription:', e.message);
        return res.status(500).json({ message: 'Gagal memperbarui langganan.' });
    }
};

// ========================== INVOICE ==========================

// GET /api/billing/admin/invoices?status=&year=&month=
exports.listInvoices = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const filters = ['i.workspace_id = ?'];
        const params = [ws];
        if (req.query.status) { filters.push('i.status = ?'); params.push(req.query.status); }
        if (req.query.year) { filters.push('i.period_year = ?'); params.push(parseInt(req.query.year)); }
        if (req.query.month) { filters.push('i.period_month = ?'); params.push(parseInt(req.query.month)); }

        const [rows] = await pool.query(
            `SELECT i.*, c.name AS customer_name, c.whatsapp_number
             FROM billing_invoices i
             JOIN billing_customers c ON c.id = i.customer_id
             WHERE ${filters.join(' AND ')}
             ORDER BY i.period_year DESC, i.period_month DESC, i.id DESC
             LIMIT 1000`,
            params
        );
        return res.status(200).json({ invoices: rows });
    } catch (e) {
        console.error('[Billing][Admin] listInvoices:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil invoice.' });
    }
};

// POST /api/billing/admin/invoices/generate   { year?, month? }
// Generate manual invoice untuk seluruh langganan aktif (idempotent).
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

// ========================== SETTINGS ==========================

// GET /api/billing/admin/settings
exports.getSettings = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const [rows] = await pool.query('SELECT * FROM billing_settings WHERE workspace_id = ?', [ws]);
        const s = rows[0] || null;
        // Jangan kembalikan kunci rahasia secara utuh.
        if (s) {
            s.tripay_api_key = s.tripay_api_key ? '****' + String(s.tripay_api_key).slice(-4) : null;
            s.tripay_private_key = s.tripay_private_key ? '********' : null;
        }
        return res.status(200).json({ settings: s });
    } catch (e) {
        console.error('[Billing][Admin] getSettings:', e.message);
        return res.status(500).json({ message: 'Gagal mengambil pengaturan.' });
    }
};

// PUT /api/billing/admin/settings   (upsert)
exports.updateSettings = async (req, res) => {
    try {
        const ws = resolveWorkspaceId(req);
        const {
            tripay_merchant_code, tripay_api_key, tripay_private_key, tripay_mode,
            invoice_gen_day, reminder_days_before, grace_days, auto_isolir_enabled, isolir_profile,
        } = req.body;

        await pool.query(
            `INSERT INTO billing_settings
                (workspace_id, tripay_merchant_code, tripay_api_key, tripay_private_key, tripay_mode,
                 invoice_gen_day, reminder_days_before, grace_days, auto_isolir_enabled, isolir_profile)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                tripay_merchant_code = COALESCE(VALUES(tripay_merchant_code), tripay_merchant_code),
                tripay_api_key = COALESCE(VALUES(tripay_api_key), tripay_api_key),
                tripay_private_key = COALESCE(VALUES(tripay_private_key), tripay_private_key),
                tripay_mode = COALESCE(VALUES(tripay_mode), tripay_mode),
                invoice_gen_day = COALESCE(VALUES(invoice_gen_day), invoice_gen_day),
                reminder_days_before = COALESCE(VALUES(reminder_days_before), reminder_days_before),
                grace_days = COALESCE(VALUES(grace_days), grace_days),
                auto_isolir_enabled = COALESCE(VALUES(auto_isolir_enabled), auto_isolir_enabled),
                isolir_profile = COALESCE(VALUES(isolir_profile), isolir_profile)`,
            [ws, tripay_merchant_code ?? null, tripay_api_key ?? null, tripay_private_key ?? null,
             tripay_mode ?? 'sandbox', invoice_gen_day ?? 1, reminder_days_before ?? 3, grace_days ?? 3,
             auto_isolir_enabled == null ? 0 : (auto_isolir_enabled ? 1 : 0), isolir_profile ?? 'Isolir']
        );
        return res.status(200).json({ message: 'Pengaturan billing disimpan.' });
    } catch (e) {
        console.error('[Billing][Admin] updateSettings:', e.message);
        return res.status(500).json({ message: 'Gagal menyimpan pengaturan.' });
    }
};
