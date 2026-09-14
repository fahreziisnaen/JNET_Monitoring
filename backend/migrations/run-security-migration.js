/**
 * Migrasi keamanan: 2FA (TOTP + kode cadangan), penanda notifikasi isolir sekali per invoice,
 * dan kolom is_global API key. Aman diulang (idempotent).
 * Jalankan: node migrations/run-security-migration.js
 */
const pool = require('../src/config/database');

async function columnExists(table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0].n > 0;
}

async function tableExists(table) {
    const [rows] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
    );
    return rows[0].n > 0;
}

async function foreignKeyExists(table, name) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [table, name]
    );
    return rows[0].n > 0;
}

const steps = [
    {
        name: 'users.totp_secret / totp_enabled / totp_last_step',
        needed: async () => !(await columnExists('users', 'totp_enabled')),
        run: () => pool.query(
            `ALTER TABLE \`users\`
               ADD COLUMN \`totp_secret\` VARCHAR(255) DEFAULT NULL COMMENT 'Secret TOTP terenkripsi AES-256-GCM',
               ADD COLUMN \`totp_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
               ADD COLUMN \`totp_last_step\` BIGINT DEFAULT NULL COMMENT 'Langkah TOTP terakhir yang dipakai (anti replay)'`
        ),
    },
    {
        name: 'tabel user_recovery_codes',
        needed: async () => !(await tableExists('user_recovery_codes')),
        run: () => pool.query(
            `CREATE TABLE \`user_recovery_codes\` (
               \`id\` INT NOT NULL AUTO_INCREMENT,
               \`user_id\` INT NOT NULL,
               \`code_hash\` CHAR(64) NOT NULL,
               \`used_at\` DATETIME DEFAULT NULL,
               \`created_at\` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (\`id\`),
               KEY \`idx_recovery_codes_user\` (\`user_id\`),
               CONSTRAINT \`fk_recovery_codes_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        ),
    },
    {
        name: 'billing_invoices.isolir_notified_at',
        needed: async () => (await tableExists('billing_invoices')) && !(await columnExists('billing_invoices', 'isolir_notified_at')),
        run: () => pool.query(
            "ALTER TABLE `billing_invoices` ADD COLUMN `isolir_notified_at` DATETIME DEFAULT NULL COMMENT 'Kapan pelanggan diberi tahu isolir (sekali per invoice)'"
        ),
    },
    {
        name: 'api_keys.is_global (Global API Key)',
        needed: async () => !(await columnExists('api_keys', 'is_global')),
        run: async () => {
            const hasFk = await foreignKeyExists('api_keys', 'fk_api_keys_workspace');
            if (hasFk) await pool.query('ALTER TABLE `api_keys` DROP FOREIGN KEY `fk_api_keys_workspace`');
            await pool.query('ALTER TABLE `api_keys` MODIFY COLUMN `workspace_id` int DEFAULT NULL');
            await pool.query('ALTER TABLE `api_keys` ADD COLUMN `is_global` tinyint(1) NOT NULL DEFAULT 0 AFTER `key_string`');
            await pool.query(
                'ALTER TABLE `api_keys` ADD CONSTRAINT `fk_api_keys_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE'
            );
        },
    },
];

async function main() {
    // --dry-run: hanya tampilkan apa yang akan diubah, tanpa menyentuh database
    const dryRun = process.argv.includes('--dry-run');
    const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
    console.log(`Database: ${db}${dryRun ? ' (DRY RUN, tidak ada perubahan)' : ''}`);

    for (const step of steps) {
        if (await step.needed()) {
            if (dryRun) {
                console.log(`→  ${step.name}: akan ditambahkan`);
                continue;
            }
            await step.run();
            console.log(`✅ ${step.name}: ditambahkan`);
        } else {
            console.log(`•  ${step.name}: sudah ada`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('Migration gagal:', e.message); process.exit(1); });
