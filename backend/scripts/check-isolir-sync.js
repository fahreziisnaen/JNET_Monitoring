const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/config/database');

function h(t) { console.log('\n=== ' + t + ' ==='); }

async function main() {
    h('1. Scheduler (backend/.env)');
    const enabled = process.env.BILLING_SCHEDULER_ENABLED === 'true';
    console.log('BILLING_SCHEDULER_ENABLED =', process.env.BILLING_SCHEDULER_ENABLED || '(kosong)', enabled ? '✅ AKTIF' : '❌ MATI — auto-isolir tidak akan pernah jalan');
    console.log('TZ                        =', process.env.TZ || '(default)');

    h('2. billing_settings per workspace');
    const [settings] = await pool.query(
        'SELECT workspace_id, auto_isolir_enabled, grace_days, isolir_profile FROM billing_settings ORDER BY workspace_id'
    );
    if (settings.length === 0) console.log('⚠️  Tidak ada baris billing_settings sama sekali.');
    console.table(settings.map((s) => ({
        workspace: s.workspace_id,
        auto_isolir: s.auto_isolir_enabled ? 'ON ✅' : 'OFF ❌',
        grace_days: s.grace_days,
        isolir_profile: s.isolir_profile,
    })));

    const [orphanWs] = await pool.query(
        `SELECT DISTINCT c.workspace_id
         FROM billing_customers c
         LEFT JOIN billing_settings s ON s.workspace_id = c.workspace_id
         WHERE s.workspace_id IS NULL`
    );
    if (orphanWs.length) {
        console.log('⚠️  Workspace punya pelanggan TAPI tanpa billing_settings (tidak akan pernah keisolir):',
            orphanWs.map((r) => r.workspace_id).join(', '));
    }

    h('3. Kesehatan link pelanggan -> secret MikroTik');
    const [[link]] = await pool.query(
        `SELECT
            COUNT(*) AS total,
            SUM(pppoe_secret_name IS NULL OR pppoe_secret_name = '') AS tanpa_secret_name,
            SUM(device_id IS NULL) AS tanpa_device_id
         FROM billing_customers`
    );
    console.log('Total pelanggan billing :', link.total);
    console.log('Tanpa pppoe_secret_name :', Number(link.tanpa_secret_name), Number(link.tanpa_secret_name) ? '❌ (router dilewati)' : '✅');
    console.log('Tanpa device_id         :', Number(link.tanpa_device_id));

    const [notCached] = await pool.query(
        `SELECT c.workspace_id, c.name, c.pppoe_secret_name
         FROM billing_customers c
         LEFT JOIN pppoe_secrets ps ON ps.workspace_id = c.workspace_id AND ps.name = c.pppoe_secret_name
         WHERE c.pppoe_secret_name IS NOT NULL AND c.pppoe_secret_name <> '' AND ps.name IS NULL`
    );
    if (notCached.length) {
        console.log('⚠️  ' + notCached.length + ' pelanggan punya secret_name yang TIDAK ada di cache pppoe_secrets (kemungkinan salah nama / belum sinkron router):');
        console.table(notCached.slice(0, 20));
    } else {
        console.log('Semua secret_name cocok dgn cache pppoe_secrets ✅');
    }

    h('4. Kandidat isolir SAAT INI (meniru query scheduler)');
    await pool.query("UPDATE billing_invoices SET status = 'overdue' WHERE status = 'unpaid' AND due_date < CURDATE()").catch(() => {});
    const [[overdue]] = await pool.query("SELECT COUNT(*) AS n FROM billing_invoices WHERE status = 'overdue'");
    console.log('Invoice overdue total :', overdue.n);
    const [cand] = await pool.query(
        `SELECT i.id AS invoice_id, i.workspace_id, i.due_date, c.name, c.pppoe_secret_name, s.grace_days
         FROM billing_invoices i
         JOIN billing_customers c ON c.id = i.customer_id
         JOIN billing_settings s ON s.workspace_id = i.workspace_id
         WHERE i.status = 'overdue' AND s.auto_isolir_enabled = 1
           AND DATE_ADD(i.due_date, INTERVAL s.grace_days DAY) < CURDATE()`
    );
    console.log('Yang MEMENUHI syarat isolir sekarang :', cand.length);
    if (cand.length) console.table(cand.slice(0, 20));

    await pool.end();
    process.exit(0);
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
