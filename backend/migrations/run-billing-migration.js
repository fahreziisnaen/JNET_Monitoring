/**
 * run-billing-migration.js
 * Runner migrasi billing untuk lingkungan TANPA mysql client (mis. CT 100 jnetmonitoring).
 * Menjalankan migrations/billing_module.sql memakai kredensial backend/.env.
 * Aman diulang (idempotent) — semua statement CREATE TABLE IF NOT EXISTS.
 *
 *   cd /var/www/JNET_Monitoring/backend
 *   node migrations/run-billing-migration.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const sqlPath = path.join(__dirname, 'billing_module.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true, // billing_module.sql berisi banyak statement
    });

    try {
        console.log(`[migrate] Menjalankan billing_module.sql ke ${process.env.DB_HOST}/${process.env.DB_NAME} ...`);
        await conn.query(sql);
        const [rows] = await conn.query(
            "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'billing_%' ORDER BY table_name"
        );
        console.log(`[migrate] ✅ Selesai. ${rows.length} tabel billing_*:`, rows.map(r => r.t).join(', '));
    } catch (e) {
        console.error('[migrate] ❌ GAGAL:', e.code || '', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
