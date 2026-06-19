const pool = require('../src/config/database');
const withTransaction = require('../src/utils/withTransaction');
const { generateInvoiceForSubscription } = require('../src/billing/services/billingService');

async function main() {
    const term = process.argv[2];
    const confirm = process.argv.includes('--confirm');
    if (!term) {
        console.log('Pemakaian: node scripts/reset-subscription-invoices.js <nama/keyword> [--confirm]');
        return;
    }

    const [custRows] = await pool.query(
        'SELECT id, workspace_id, name FROM billing_customers WHERE name LIKE ?',
        [`%${term}%`]
    );
    if (custRows.length === 0) { console.log(`Pelanggan "${term}" tidak ditemukan.`); return; }
    if (custRows.length > 1) {
        console.log(`Lebih dari satu pelanggan cocok dengan "${term}". Persempit:`);
        custRows.forEach((c) => console.log(`  - #${c.id} ${c.name}`));
        return;
    }
    const customer = custRows[0];

    const [subRows] = await pool.query(
        `SELECT id, workspace_id, customer_id, package_id, due_day_of_month, status,
                DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date
         FROM billing_subscriptions
         WHERE customer_id = ?
         ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
        [customer.id]
    );
    if (subRows.length === 0) { console.log(`${customer.name} belum punya langganan.`); return; }
    const sub = subRows[0];

    const [invRows] = await pool.query(
        `SELECT id, invoice_number, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, amount
         FROM billing_invoices WHERE subscription_id = ? ORDER BY id`,
        [sub.id]
    );

    const startYear = parseInt(sub.start_date.slice(0, 4), 10);
    const startMonth = parseInt(sub.start_date.slice(5, 7), 10);

    console.log(`Pelanggan : ${customer.name} (#${customer.id})`);
    console.log(`Langganan : #${sub.id} mulai ${sub.start_date} (jatuh tempo tiap tgl ${sub.due_day_of_month})`);
    console.log(`Invoice yang AKAN DIHAPUS (${invRows.length}):`);
    invRows.forEach((i) => console.log(`  - ${i.invoice_number} [${i.status}] tempo ${i.due_date} Rp ${Number(i.amount).toLocaleString('id-ID')}`));
    console.log(`Akan dibuat ulang: invoice bulan pasang ${startYear}-${String(startMonth).padStart(2, '0')} (auto-LUNAS / cash).`);

    if (!confirm) {
        console.log('\n[DRY-RUN] Tidak ada yang diubah. Tambahkan --confirm untuk mengeksekusi.');
        return;
    }

    await withTransaction(async (conn) => {
        await conn.query('DELETE FROM billing_invoices WHERE subscription_id = ?', [sub.id]);

        const inv = await generateInvoiceForSubscription(
            { id: sub.id, workspace_id: sub.workspace_id, customer_id: sub.customer_id, package_id: sub.package_id, due_day_of_month: sub.due_day_of_month, status: 'active' },
            startYear, startMonth, conn
        );
        if (!inv.created) throw new Error(`Gagal membuat invoice: ${inv.reason}`);

        await conn.query(
            "UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
            [sub.start_date, inv.invoiceId]
        );
        const [amtRows] = await conn.query('SELECT amount FROM billing_invoices WHERE id = ?', [inv.invoiceId]);
        const amount = amtRows[0] ? amtRows[0].amount : 0;
        await conn.query(
            `INSERT INTO billing_payments (workspace_id, invoice_id, provider, merchant_ref, payment_method, amount, status, paid_at)
             VALUES (?, ?, 'manual', ?, 'cash', ?, 'paid', ?)`,
            [sub.workspace_id, inv.invoiceId, `CASH-INV${inv.invoiceId}`, amount, sub.start_date]
        );
    });

    console.log('\nSelesai. Invoice lama dihapus, invoice bulan pasang dibuat ulang sebagai LUNAS.');
    console.log('Catatan: bulan-bulan setelahnya (mis. Mei/Juni) TIDAK dibuat otomatis — pakai "Generate Invoice Bulan Ini" bila perlu.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
