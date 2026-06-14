const pool = require('../src/config/database');

async function main() {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_customers' AND COLUMN_NAME = 'ktp_number'`
    );
    if (rows[0].n > 0) {
        console.log('Kolom ktp_number sudah ada. Tidak ada perubahan.');
        return;
    }
    await pool.query(
        "ALTER TABLE `billing_customers` ADD COLUMN `ktp_number` VARCHAR(32) DEFAULT NULL COMMENT 'No. KTP pelanggan (opsional)' AFTER `name`"
    );
    console.log('Kolom ktp_number berhasil ditambahkan.');
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('Migration gagal:', e.message); process.exit(1); });
