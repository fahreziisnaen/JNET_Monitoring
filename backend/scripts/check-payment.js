const pool = require('../src/config/database');

async function main() {
    const term = process.argv[2] || '';
    const like = `%${term}%`;

    const [rows] = await pool.query(
        `SELECT i.invoice_number, i.status AS invoice_status, i.amount,
                DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date, i.paid_at AS invoice_paid_at,
                c.name AS customer, s.start_date AS sub_start,
                p.id AS payment_id, p.provider, p.payment_method, p.status AS payment_status,
                p.merchant_ref, p.provider_ref, p.paid_at AS payment_paid_at, p.created_at AS payment_created
         FROM billing_invoices i
         JOIN billing_customers c ON c.id = i.customer_id
         LEFT JOIN billing_subscriptions s ON s.id = i.subscription_id
         LEFT JOIN billing_payments p ON p.invoice_id = i.id
         WHERE c.name LIKE ? OR i.invoice_number LIKE ?
         ORDER BY i.id DESC, p.id DESC`,
        [like, like]
    );

    if (rows.length === 0) {
        console.log(`Tidak ada data untuk "${term}".`);
        return;
    }

    for (const r of rows) {
        console.log('--------------------------------------------------');
        console.log(`Invoice   : ${r.invoice_number} (${r.invoice_status}) Rp ${Number(r.amount).toLocaleString('id-ID')}`);
        console.log(`Pelanggan : ${r.customer}`);
        console.log(`Jatuh tempo: ${r.due_date} | mulai langganan: ${r.sub_start}`);
        console.log(`Invoice paid_at: ${r.invoice_paid_at || '-'}`);
        if (r.payment_id) {
            console.log(`  Pembayaran #${r.payment_id}: provider=${r.provider} metode=${r.payment_method} status=${r.payment_status}`);
            console.log(`     merchant_ref=${r.merchant_ref} provider_ref=${r.provider_ref || '-'}`);
            console.log(`     paid_at=${r.payment_paid_at || '-'} dibuat=${r.payment_created}`);
        } else {
            console.log('  (tidak ada baris pembayaran)');
        }
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
