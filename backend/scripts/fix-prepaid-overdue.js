const pool = require('../src/config/database');
const withTransaction = require('../src/utils/withTransaction');

async function main() {
    const [rows] = await pool.query(
        `SELECT i.id, i.workspace_id, i.invoice_number, i.amount, i.due_date
         FROM billing_invoices i
         WHERE i.status = 'overdue'
           AND NOT EXISTS (
               SELECT 1 FROM billing_payments p
               WHERE p.invoice_id = i.id AND p.status = 'paid'
           )`
    );

    if (rows.length === 0) {
        console.log('Tidak ada invoice overdue tanpa pembayaran. Tidak ada yang diubah.');
        return;
    }

    console.log(`Menemukan ${rows.length} invoice overdue (dianggap prabayar saat pemasangan):`);
    for (const r of rows) {
        console.log(`  - ${r.invoice_number} | Rp ${Number(r.amount).toLocaleString('id-ID')} | jatuh tempo ${r.due_date}`);
    }

    for (const r of rows) {
        await withTransaction(async (conn) => {
            await conn.query(
                "UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?",
                [r.due_date, r.id]
            );
            await conn.query(
                `INSERT INTO billing_payments (workspace_id, invoice_id, provider, merchant_ref, payment_method, amount, status, paid_at)
                 VALUES (?, ?, 'manual', ?, 'cash', ?, 'paid', ?)`,
                [r.workspace_id, r.id, `CASH-INV${r.id}`, r.amount, r.due_date]
            );
        });
        console.log(`  -> ${r.invoice_number} ditandai PAID.`);
    }

    console.log('Selesai.');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
