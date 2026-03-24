-- Migration: Add device_id to ip_pools table
-- Date: 2024-03-23

-- 1. Tambahkan kolom device_id (izinkan NULL sementara untuk data lama)
ALTER TABLE `ip_pools` ADD COLUMN `device_id` INT NULL AFTER `workspace_id`;

-- 2. Update data lama: Jika ada device_id di mikrotik_devices untuk workspace tersebut, gunakan salah satunya
-- (Ini adalah best-effort untuk data migrasi)
UPDATE `ip_pools` p 
JOIN `mikrotik_devices` d ON p.workspace_id = d.workspace_id 
SET p.device_id = d.id 
WHERE p.device_id IS NULL;

-- 3. Hapus data yang masih NULL device_id-nya (jika workspace tidak punya device sama sekali)
-- DELETE FROM `ip_pools` WHERE `device_id` IS NULL;

-- 4. Ubah device_id menjadi NOT NULL setelah data terisi
ALTER TABLE `ip_pools` MODIFY COLUMN `device_id` INT NOT NULL;

-- 5. Update UNIQUE KEY
ALTER TABLE `ip_pools` DROP INDEX `workspace_profile`;
ALTER TABLE `ip_pools` ADD UNIQUE KEY `unique_pool_per_device` (`workspace_id`, `device_id`, `profile_name`);

-- 6. Tambahkan Foreign Key
ALTER TABLE `ip_pools` ADD CONSTRAINT `fk_ip_pools_device` FOREIGN KEY (`device_id`) REFERENCES `mikrotik_devices` (`id`) ON DELETE CASCADE;
