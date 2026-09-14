const pool = require('../src/config/database');

async function main() {
    console.log('[Migration] Memulai perbaikan device_id pada tabel clients...');

    // 1. Re-link clients.device_id berdasarkan pppoe_secrets yang valid
    const [relinkResult] = await pool.query(`
        UPDATE clients c
        JOIN pppoe_secrets ps ON c.workspace_id = ps.workspace_id AND c.pppoe_secret_name = ps.name
        SET c.device_id = ps.device_id
        WHERE c.device_id IS NULL OR c.device_id != ps.device_id
    `);
    console.log(`[Migration] Sinkronisasi clients dengan pppoe_secrets: ${relinkResult.affectedRows} client diperbarui.`);

    // 2. Cek client yang device_id-nya masih menunjuk ke perangkat mikrotik yang sudah tidak ada
    const [danglingClients] = await pool.query(`
        SELECT c.id, c.workspace_id, c.pppoe_secret_name, c.device_id
        FROM clients c
        LEFT JOIN mikrotik_devices md ON c.device_id = md.id
        WHERE md.id IS NULL
    `);

    if (danglingClients.length > 0) {
        console.log(`[Migration] Ditemukan ${danglingClients.length} client dengan device_id usang/terhapus.`);
        for (const cl of danglingClients) {
            // Cari device yang tersedia di workspace ini
            const [devices] = await pool.query(
                'SELECT id FROM mikrotik_devices WHERE workspace_id = ? ORDER BY id DESC',
                [cl.workspace_id]
            );
            if (devices.length > 0) {
                const targetDeviceId = devices[0].id;
                await pool.query('UPDATE clients SET device_id = ? WHERE id = ?', [targetDeviceId, cl.id]);
                console.log(`[Migration] Client ${cl.pppoe_secret_name} (ID: ${cl.id}) diarahkan ke device ID ${targetDeviceId}`);
            } else {
                await pool.query('UPDATE clients SET device_id = NULL WHERE id = ?', [cl.id]);
                console.log(`[Migration] Client ${cl.pppoe_secret_name} (ID: ${cl.id}) di-reset device_id menjadi NULL (belum ada router)`);
            }
        }
    } else {
        console.log('[Migration] Tidak ada client dengan device_id usang/terhapus.');
    }

    console.log('[Migration] Selesai!');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[Migration] Gagal:', e.message);
        process.exit(1);
    });
