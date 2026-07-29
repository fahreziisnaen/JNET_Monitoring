const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/config/database');

async function main() {
    const [r] = await pool.query(
        `INSERT INTO billing_settings (workspace_id, grace_days, isolir_profile)
         SELECT DISTINCT c.workspace_id, 5, 'Isolir'
         FROM billing_customers c
         LEFT JOIN billing_settings s ON s.workspace_id = c.workspace_id
         WHERE s.workspace_id IS NULL`
    );
    console.log(`billing_settings dibuat untuk ${r.affectedRows} workspace (auto_isolir OFF, grace 5 hari, profil 'Isolir').`);
    const [rows] = await pool.query(
        'SELECT workspace_id, auto_isolir_enabled, grace_days, isolir_profile FROM billing_settings ORDER BY workspace_id'
    );
    console.table(rows);
    await pool.end();
    process.exit(0);
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
