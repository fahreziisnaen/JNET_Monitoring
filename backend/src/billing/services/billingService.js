/**
 * billingService.js
 * Helper murni untuk logika tagihan: nomor invoice, perhitungan jatuh tempo,
 * dan generate invoice untuk satu langganan / seluruh workspace.
 *
 * Dipanggil oleh: invoiceController (manual generate) dan billingScheduler (cron).
 */
const pool = require('../../config/database');

/** Bentuk nomor invoice unik: INV-<ws>-<YYYYMM>-<subId>. */
function buildInvoiceNumber(workspaceId, year, month, subscriptionId) {
    const mm = String(month).padStart(2, '0');
    return `INV-${workspaceId}-${year}${mm}-${subscriptionId}`;
}

/** Hitung tanggal jatuh tempo (YYYY-MM-DD) dari tahun, bulan, dan tanggal jatuh tempo. */
function computeDueDate(year, month, dueDay) {
    // Clamp dueDay ke jumlah hari di bulan tsb (mis. 31 -> 28/30)
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(Math.max(parseInt(dueDay) || 1, 1), lastDay);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

/**
 * Generate invoice untuk SATU langganan pada periode tertentu (idempotent).
 * Mengembalikan { created: boolean, invoiceId, reason }.
 */
async function generateInvoiceForSubscription(subscription, year, month, conn = pool) {
    const {
        id: subscriptionId,
        workspace_id,
        customer_id,
        package_id,
        due_day_of_month,
        status,
    } = subscription;

    if (status !== 'active') {
        return { created: false, reason: 'subscription_not_active' };
    }

    // Idempotensi via UNIQUE(subscription_id, period_year, period_month)
    const [existing] = await conn.query(
        'SELECT id FROM billing_invoices WHERE subscription_id = ? AND period_year = ? AND period_month = ?',
        [subscriptionId, year, month]
    );
    if (existing.length > 0) {
        return { created: false, invoiceId: existing[0].id, reason: 'already_exists' };
    }

    const [pkgRows] = await conn.query('SELECT price FROM billing_packages WHERE id = ?', [package_id]);
    if (pkgRows.length === 0) {
        return { created: false, reason: 'package_not_found' };
    }
    const amount = pkgRows[0].price;

    const invoiceNumber = buildInvoiceNumber(workspace_id, year, month, subscriptionId);
    const dueDate = computeDueDate(year, month, due_day_of_month);

    const [result] = await conn.query(
        `INSERT INTO billing_invoices
            (workspace_id, subscription_id, customer_id, invoice_number, period_year, period_month, amount, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`,
        [workspace_id, subscriptionId, customer_id, invoiceNumber, year, month, amount, dueDate]
    );

    return { created: true, invoiceId: result.insertId, reason: 'created' };
}

/**
 * Generate invoice untuk SEMUA langganan aktif sebuah workspace pada periode tertentu.
 * Default periode = bulan berjalan. Mengembalikan ringkasan jumlah dibuat / dilewati.
 */
async function generateInvoicesForWorkspace(workspaceId, year, month) {
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || now.getMonth() + 1;

    const [subs] = await pool.query(
        "SELECT * FROM billing_subscriptions WHERE workspace_id = ? AND status = 'active'",
        [workspaceId]
    );

    let created = 0;
    let skipped = 0;
    const invoiceIds = [];
    for (const sub of subs) {
        const r = await generateInvoiceForSubscription(sub, y, m);
        if (r.created) {
            created++;
            invoiceIds.push(r.invoiceId);
        } else {
            skipped++;
        }
    }
    return { workspaceId, year: y, month: m, total: subs.length, created, skipped, invoiceIds };
}

module.exports = {
    buildInvoiceNumber,
    computeDueDate,
    generateInvoiceForSubscription,
    generateInvoicesForWorkspace,
};
