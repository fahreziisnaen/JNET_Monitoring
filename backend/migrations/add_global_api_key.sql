-- Migration: Tambah dukungan Global API Key
-- Jalankan sekali pada database yang sudah berjalan

-- 1. Hapus FK constraint dulu agar bisa ubah workspace_id jadi nullable
ALTER TABLE `api_keys` DROP FOREIGN KEY `fk_api_keys_workspace`;

-- 2. Ubah workspace_id menjadi nullable
ALTER TABLE `api_keys` MODIFY COLUMN `workspace_id` int DEFAULT NULL;

-- 3. Tambah kolom is_global
ALTER TABLE `api_keys` ADD COLUMN `is_global` tinyint(1) NOT NULL DEFAULT 0 AFTER `key_string`;

-- 4. Pasang kembali FK constraint (nullable FK diperbolehkan di MySQL)
ALTER TABLE `api_keys`
    ADD CONSTRAINT `fk_api_keys_workspace`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE;
