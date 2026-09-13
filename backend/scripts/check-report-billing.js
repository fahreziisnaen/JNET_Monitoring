const pool = require('../src/config/database');

// Diagnostik: kenapa sebagian pelanggan tidak muncul nominal tagihan di laporan bulanan PDF.
// Pemakaian:
//   node scripts/check-report-billing.js                     # bulan berjalan
//   node scripts/check-report-billing.js 2026 8               # bulan tertentu
//   node scripts/check-report-billing.js 2026 8 0             # semua device (default) / 1 = device tertentu
async function main() {
    const year = parseInt(process.argv[2] || new Date().getFullYear(), 10);
    const month = parseInt(process.argv[3] || new Date().getMonth() + 1, 10);
    const deviceFilter = process.argv[4] ? `AND device_id = ${parseInt(process.argv[4], 10)}` : '';

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

    console.log(`=== Diagnostik Nominal Tagihan Laporan Bulanan: ${year}-${String(month).padStart(2, '0')} (periode ${startDate} s/d ${endDate}) ===`);

    const [wsRows] = await pool.query('SELECT id, name FROM workspaces ORDER BY id');
    if (!wsRows.length) { console.log('(tidak ada workspace)'); process.exit(0); }

    let anyInvoice = false;

    for (const ws of wsRows) {
        const wsId = ws.id;
        const [rows] = await pool.query(
            `SELECT u.pppoe_user,
                    bc.id AS cust_id, bc.pppoe_secret_name AS cust_secret, bc.name AS customer_name,
                    i.id AS invoice_id, i.status AS invoice_status, i.amount
             FROM (SELECT DISTINCT pppoe_user
                   FROM pppoe_usage_logs
                   WHERE workspace_id = ? AND usage_date BETWEEN ? AND ? ${deviceFilter}) u
             LEFT JOIN billing_customers bc
                    ON bc.workspace_id = ? AND bc.pppoe_secret_name = u.pppoe_user
             LEFT JOIN billing_invoices i
                    ON i.workspace_id = ? AND i.period_year = ? AND i.period_month = ?
                       AND i.customer_id = bc.id AND i.status <> 'void'
             ORDER BY i.invoice_id IS NULL, i.invoice_id IS NOT NULL DESC, u.pppoe_user
             LIMIT 1000`,
            [wsId, startDate, endDate, wsId, wsId, year, month]
        );

        if (!rows.length) continue;

        let withCust = 0, withInvoice = 0, withCustNoInvoice = 0, noCust = 0;
        const noInvoiceSamples = [], noCustSamples = [];
        for (const r of rows) {
            const hasCust = r.cust_id != null;
            const hasInv = r.invoice_id != null;
            if (hasCust) withCust++;
            if (hasInv) withInvoice++;
            if (hasCust && !hasInv) { withCustNoInvoice++; if (noInvoiceSamples.length < 8) noInvoiceSamples.push({ u: r.pppoe_user, c: r.customer_name || '?', inv: r.invoice_id === null ? 'TIDAK ADA INVOICE' : `status=${r.invoice_status}` }); }
            if (!hasCust) { noCust++; if (noCustSamples.length < 8) noCustSamples.push(r.pppoe_user); }
        }

        const [nullSecret] = await pool.query(
            'SELECT COUNT(*) AS n FROM billing_customers WHERE workspace_id = ? AND (pppoe_secret_name IS NULL OR pppoe_secret_name = "")',
            [wsId]
        );
        const [subs] = await pool.query(
            `SELECT COUNT(DISTINCT s.customer_id) AS n
             FROM billing_subscriptions s
             JOIN billing_invoices i ON i.subscription_id = s.id
             WHERE s.workspace_id = ? AND i.period_year = ? AND i.period_month = ? AND i.status <> 'void'`,
            [wsId, year, month]
        );

        if (withInvoice > 0) anyInvoice = true;

        console.log(`\n[${ws.name || `Workspace #${wsId}`}]`);
        console.log(`  User ber-usage bulan ini        : ${rows.length}`);
        console.log(`  ├─ Punya billing customer+invoice: ${withInvoice}  (NOMINAL MUNCUL ✓)`);
        console.log(`  ├─ Punya customer, TANPA invoice : ${withCustNoInvoice}  ('-')  <- ${noInvoiceSamples.length ? 'mis: ' + noInvoiceSamples.map(s => s.u + '(' + s.inv + ')').join(', ') : ''}`);
        console.log(`  └─ TANPA billing customer        : ${noCust}  ('-')  <- ${noCustSamples.length ? 'mis: ' + noCustSamples.join(', ') : ''}`);
        console.log(`  Detail tambahan:`);
        console.log(`     - billing_customers dengan pppoe_secret_name KOSONG : ${nullSecret[0].n}`);
        console.log(`     - pelanggan berinvoice bulan ini (sub aktif)        : ${subs[0].n}`);
    }

    console.log(`\nRingkasan: ${anyInvoice ? 'ADA invoice periode tsb (yang '-' karena customer tanpa invoice/secret).' : 'TIDAK ada invoice sama sekali periode tsb -> nominal kosong semua.'}`);
    console.log('Tips:');
    console.log('  1) Pastikan invoice bulan tsb sudah di-GENERATE (tab Invoice di halaman Billing).');
    console.log('  2) Pastikan pelanggan punya LANGGAAN/paket aktif & billing_customers.pppoe_secret_name terisi.');
    console.log('  3) Kalau pelanggan dibuat manual tanpa secret PPPoE, hubungkan dari tab Pelanggan (nama secret sama dgn di router / clients).');

    await pool.end();
    process.exit(0);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });