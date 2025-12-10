# Deployment Guide - JNET Monitoring Tools

## 🆕 Fresh Install (Instalasi Baru)

### 1. Database Setup

```bash
# Login ke MySQL
mysql -u root -p

# Jalankan setup script
mysql -u root -p < backend/database_setup.sql
```

Database akan otomatis membuat:
- ✅ Semua tabel dengan schema lengkap
- ✅ Default admin user (username: `admin`, password: `admin123`)
- ✅ Timezone Asia/Jakarta (UTC+7)
- ✅ Indexes dan foreign keys
- ✅ device_id column di resource_logs

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env sesuai konfigurasi

# Create uploads directory
mkdir -p public/uploads/avatars
cp default.jpg public/uploads/avatars/

# Start dengan PM2 (dengan memory optimization)
pm2 start server.js --name backend --max-memory-restart 1G --node-args="--max-old-space-size=2048 --expose-gc"

# Save PM2 config
pm2 save
pm2 startup
```

### 3. Frontend Setup

```bash
cd next

# Install dependencies
npm install

# Configure environment
cp .env.example .env.production
# Edit .env.production sesuai konfigurasi

# Build production
npm run build

# Start dengan PM2
pm2 start npm --name frontend -- start

# Save PM2 config
pm2 save
```

### 4. Verifikasi

```bash
# Check PM2 status
pm2 status

# Monitor logs
pm2 logs

# Monitor memory
pm2 monit
```

---

## 🔄 Upgrade (dari Versi Lama)

### 1. Database Migration

```bash
# WAJIB: Jalankan migration script untuk fix device_id
mysql -u root -p < backend/fix_database_migration.sql
```

### 2. Update Code

```bash
# Pull latest code
git pull origin main

# Update backend dependencies
cd backend
npm install

# Update frontend dependencies
cd ../next
npm install
npm run build
```

### 3. Restart Services

```bash
# Restart backend dengan memory optimization baru
pm2 delete backend
pm2 start server.js --name backend --max-memory-restart 1G --node-args="--max-old-space-size=2048 --expose-gc"

# Restart frontend
pm2 restart frontend

# Save config
pm2 save
```

### 4. Cleanup Old Data (Opsional)

```sql
USE jnet_monitoring;

-- Hapus data lama untuk menghemat storage
DELETE FROM resource_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY);
DELETE FROM downtime_events WHERE start_time < DATE_SUB(NOW(), INTERVAL 90 DAY);
DELETE FROM pppoe_usage_logs WHERE usage_date < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Optimize tables
OPTIMIZE TABLE resource_logs;
OPTIMIZE TABLE downtime_events;
OPTIMIZE TABLE pppoe_usage_logs;
```

---

## 🔧 Troubleshooting

### Error: "Unknown column 'device_id'"

**Solusi**: Jalankan migration script
```bash
mysql -u root -p < backend/fix_database_migration.sql
```

### Error: "Out of Memory"

**Solusi**: 
1. Restart backend dengan memory limit lebih besar
2. Jalankan cleanup data lama
3. Monitor dengan `pm2 monit`

### Error: "Cannot connect to database"

**Solusi**: 
1. Check MySQL service: `sudo systemctl status mysql`
2. Verify .env configuration
3. Check database user permissions

---

## 📊 Monitoring

### Check Application Health

```bash
# PM2 status
pm2 status

# Real-time logs
pm2 logs backend --lines 100

# Memory monitoring
pm2 monit
```

### Check Database Health

```bash
# Database size
mysql -u root -p -e "SELECT 
  TABLE_NAME, 
  ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'jnet_monitoring'
ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC;"

# Check for errors
pm2 logs backend | grep "error"
pm2 logs backend | grep "device_id"
```

---

## 🎯 Best Practices

1. **Always backup database before upgrade**
   ```bash
   mysqldump -u root -p jnet_monitoring > backup_$(date +%Y%m%d).sql
   ```

2. **Monitor memory usage regularly**
   ```bash
   pm2 monit
   ```

3. **Setup log rotation**
   ```bash
   pm2 install pm2-logrotate
   ```

4. **Setup monitoring alerts** (recommended for production)
   - Use Prometheus + Grafana
   - Setup email/WhatsApp alerts for high memory usage

---

## ⚙️ Automatic Features

Fitur-fitur yang sudah berjalan otomatis:

✅ **Database Cleanup** (Daily at 02:00 AM)
- Hapus resource logs > 30 hari
- Hapus downtime events > 90 hari
- Hapus pppoe usage logs > 90 hari
- Optimize tables

✅ **Background Monitoring** (Every 3 seconds)
- Resource logging
- SLA monitoring
- Dashboard snapshot updates
- Downtime notifications

✅ **Memory Management**
- Automatic restart on memory limit (1GB)
- Garbage collection (if --expose-gc)
- Connection pooling

---

## 📝 Configuration Files

```
backend/
  ├── .env                          # Backend configuration
  ├── database_setup.sql            # Fresh install database
  ├── fix_database_migration.sql    # Upgrade migration
  └── server.js                     # Main server (includes cleanup cron)

next/
  ├── .env.production               # Frontend production config
  └── next.config.ts                # Next.js configuration
```

---

## 🆘 Support

Jika mengalami masalah:

1. Check logs: `pm2 logs backend`
2. Check database: Verify device_id column exists
3. Check memory: `pm2 monit`
4. Refer to: `FIX_MEMORY_AND_DATABASE.md`

