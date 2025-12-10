# Fix untuk OOM (Out of Memory) dan Database Error

## Masalah yang Ditemukan

### 1. Database Error: Column 'device_id' tidak ditemukan
**Error**: `Unknown column 'device_id' in 'field list'`

**Penyebab**: Tabel `resource_logs` tidak memiliki kolom `device_id` di database yang sedang berjalan (versi lama).

**Solusi**: Jalankan script migrasi database

**CATATAN PENTING**:
- ✅ **Fresh Install** (instalasi baru): `database_setup.sql` sudah include `device_id`, tidak perlu migration
- ⚠️ **Upgrade** (dari versi lama): Perlu jalankan `fix_database_migration.sql`

### 2. Out of Memory (OOM) Error
**Error**: `JavaScript heap out of memory`

**Penyebab**: 
- Data interface yang besar (semua properties) disimpan ke JSON tanpa filtering
- Tidak ada limit untuk data yang diambil dari Mikrotik
- Akumulasi data lama tanpa cleanup
- Memory leak dari monitoring cycle yang berjalan terus menerus

## Cara Perbaiki

### Step 1: Fix Database (HANYA untuk UPGRADE dari versi lama)

**⚠️ Skip langkah ini jika Anda fresh install! Schema baru sudah include device_id.**

Untuk upgrade dari versi lama, jalankan script migrasi berikut di MySQL:

```bash
mysql -u root -p < backend/fix_database_migration.sql
```

Script ini akan:
- Menambahkan kolom `device_id` ke tabel `resource_logs` (jika belum ada)
- Menambahkan index untuk performa query (jika belum ada)
- Menambahkan foreign key constraint (jika belum ada)
- Safe untuk dijalankan berkali-kali (idempotent)

### Step 2: Restart Backend dengan Memory Limit (WAJIB)

Setelah database diperbaiki, restart backend dengan memory limit yang lebih besar:

```bash
pm2 delete backend
pm2 start server.js --name backend --max-memory-restart 1G --node-args="--max-old-space-size=2048"
```

Opsi `--expose-gc` untuk garbage collection otomatis (opsional):

```bash
pm2 start server.js --name backend --max-memory-restart 1G --node-args="--max-old-space-size=2048 --expose-gc"
```

### Step 3: Cleanup Data Lama (Opsional tapi Direkomendasikan)

Hapus data lama untuk menghemat storage dan memory:

```sql
USE jnet_monitoring;

-- Hapus resource logs lebih dari 30 hari
DELETE FROM resource_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- Hapus downtime events lebih dari 90 hari
DELETE FROM downtime_events WHERE start_time < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Hapus pppoe usage logs lebih dari 90 hari
DELETE FROM pppoe_usage_logs WHERE usage_date < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Optimize tables
OPTIMIZE TABLE resource_logs;
OPTIMIZE TABLE downtime_events;
OPTIMIZE TABLE pppoe_usage_logs;
```

## Fitur Baru yang Sudah Ditambahkan

### Automatic Database Cleanup

Cleanup cron job sudah **otomatis ditambahkan** ke `server.js` yang akan berjalan setiap hari jam 02:00:

- ✅ Hapus resource logs > 30 hari
- ✅ Hapus downtime events > 90 hari
- ✅ Hapus pppoe usage logs > 90 hari
- ✅ Optimize tables otomatis
- ✅ Garbage collection (jika --expose-gc diaktifkan)

Tidak perlu menambahkan kode apapun, cleanup sudah otomatis!

## Monitoring

Setelah perbaikan, monitor:

```bash
# Monitor memory
pm2 monit

# Check logs
pm2 logs backend --lines 100

# Check database size
mysql -u root -p -e "SELECT 
  TABLE_NAME, 
  ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'jnet_monitoring'
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC;"
```

## Verifikasi

Setelah fix, pastikan tidak ada error lagi:

```bash
# Pastikan tidak ada error device_id
pm2 logs backend | grep "device_id"

# Pastikan tidak ada OOM
pm2 logs backend | grep "out of memory"
```

## Catatan

- Error `device_id` akan hilang setelah migrasi database
- OOM mungkin butuh beberapa optimasi tambahan tergantung jumlah device dan data
- Sebaiknya setup monitoring resource dengan Prometheus/Grafana untuk produksi

