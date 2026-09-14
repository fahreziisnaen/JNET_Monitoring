-- =====================================================================
-- Migration: Billing Module (fondasi aplikasi billing pelanggan)
-- Jalankan sekali pada database JNET Monitoring yang sudah berjalan:
--   mysql -u root -p jnet_monitoring < backend/migrations/billing_module.sql
--
-- Semua tabel ber-prefix `billing_` dan workspace-scoped (multi-tenant)
-- mengikuti pola tabel inti. Customer billing adalah identitas TERPISAH
-- dari `users` (admin) — punya sesi & OTP sendiri.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. Pengaturan billing + kredensial payment gateway per-workspace
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_settings` (
  `workspace_id` INT NOT NULL,
  -- Tripay (default gateway pertama; layer service tetap abstrak)
  `tripay_merchant_code` VARCHAR(50) DEFAULT NULL,
  `tripay_api_key` VARCHAR(255) DEFAULT NULL,
  `tripay_private_key` VARCHAR(255) DEFAULT NULL,
  `tripay_mode` ENUM('sandbox','production') NOT NULL DEFAULT 'sandbox',
  -- Kebijakan tagihan & isolir semi-otomatis
  `invoice_gen_day` INT NOT NULL DEFAULT 1 COMMENT 'Tanggal generate invoice tiap bulan',
  `reminder_days_before` INT NOT NULL DEFAULT 3 COMMENT 'Kirim reminder WA H- berapa hari sebelum jatuh tempo',
  `grace_days` INT NOT NULL DEFAULT 3 COMMENT 'Masa tenggang setelah jatuh tempo sebelum boleh isolir',
  `auto_isolir_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Aktifkan auto-isolir setelah grace habis',
  `isolir_profile` VARCHAR(100) NOT NULL DEFAULT 'Isolir' COMMENT 'Nama profil PPPoE untuk isolir',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`),
  CONSTRAINT `fk_billing_settings_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. Paket layanan (plan) — dipetakan ke profil PPPoE MikroTik
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_packages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspace_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `speed_mbps` INT DEFAULT NULL,
  `pppoe_profile` VARCHAR(100) DEFAULT NULL COMMENT 'Profil PPPoE yg dipulihkan saat aktif/lunas',
  `billing_cycle` ENUM('monthly') NOT NULL DEFAULT 'monthly',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_packages_ws` (`workspace_id`),
  CONSTRAINT `fk_billing_packages_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. Pelanggan billing — identitas login aplikasi billing.
--    Terhubung ke `clients` (lokasi/peta) & nama secret PPPoE (untuk isolir).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_customers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspace_id` INT NOT NULL,
  `client_id` INT DEFAULT NULL COMMENT 'FK ke clients.id (data lokasi/peta)',
  `device_id` INT DEFAULT NULL COMMENT 'Device MikroTik asal (untuk isolir)',
  `pppoe_secret_name` VARCHAR(100) DEFAULT NULL COMMENT 'Nama secret PPPoE untuk aksi isolir/unisolir',
  `name` VARCHAR(100) DEFAULT NULL,
  `whatsapp_number` VARCHAR(20) NOT NULL,
  `email` VARCHAR(120) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_billing_cust_wa_per_ws` (`workspace_id`, `whatsapp_number`),
  KEY `idx_billing_customers_ws` (`workspace_id`),
  KEY `idx_billing_customers_client` (`client_id`),
  KEY `idx_billing_customers_secret` (`pppoe_secret_name`),
  CONSTRAINT `fk_billing_customers_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_customers_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. Sesi login pelanggan (untuk revoke JWT, mirror user_sessions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_customer_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NOT NULL,
  `token_id` VARCHAR(64) NOT NULL COMMENT 'jti claim JWT',
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `ip_address` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_sessions_customer` (`customer_id`),
  KEY `idx_billing_sessions_token` (`token_id`),
  CONSTRAINT `fk_billing_sessions_customer` FOREIGN KEY (`customer_id`) REFERENCES `billing_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. OTP login pelanggan via WhatsApp
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_customer_otps` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `whatsapp_number` VARCHAR(20) NOT NULL,
  `otp_code` VARCHAR(10) NOT NULL,
  `purpose` ENUM('login') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_otps_wa` (`whatsapp_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. Langganan: pelanggan <-> paket
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_subscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspace_id` INT NOT NULL,
  `customer_id` INT NOT NULL,
  `package_id` INT NOT NULL,
  `status` ENUM('active','suspended','cancelled') NOT NULL DEFAULT 'active',
  `start_date` DATE NOT NULL,
  `due_day_of_month` INT NOT NULL DEFAULT 1 COMMENT 'Tanggal jatuh tempo tiap bulan',
  `next_due_date` DATE DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_billing_subs_ws` (`workspace_id`),
  KEY `idx_billing_subs_customer` (`customer_id`),
  KEY `idx_billing_subs_package` (`package_id`),
  CONSTRAINT `fk_billing_subs_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_subs_customer` FOREIGN KEY (`customer_id`) REFERENCES `billing_customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_subs_package` FOREIGN KEY (`package_id`) REFERENCES `billing_packages` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. Invoice / tagihan bulanan
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_invoices` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspace_id` INT NOT NULL,
  `subscription_id` INT NOT NULL,
  `customer_id` INT NOT NULL,
  `invoice_number` VARCHAR(40) NOT NULL,
  `period_year` INT NOT NULL,
  `period_month` INT NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `due_date` DATE NOT NULL,
  `status` ENUM('unpaid','paid','overdue','void') NOT NULL DEFAULT 'unpaid',
  `paid_at` DATETIME DEFAULT NULL,
  `isolir_notified_at` DATETIME DEFAULT NULL COMMENT 'Kapan pelanggan diberi tahu isolir (sekali per invoice)',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_billing_invoice_period` (`subscription_id`, `period_year`, `period_month`),
  UNIQUE KEY `uniq_billing_invoice_number` (`invoice_number`),
  KEY `idx_billing_invoices_ws` (`workspace_id`),
  KEY `idx_billing_invoices_customer` (`customer_id`),
  KEY `idx_billing_invoices_status` (`status`),
  CONSTRAINT `fk_billing_invoices_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_invoices_sub` FOREIGN KEY (`subscription_id`) REFERENCES `billing_subscriptions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_invoices_customer` FOREIGN KEY (`customer_id`) REFERENCES `billing_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. Transaksi pembayaran (payment gateway)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `billing_payments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspace_id` INT NOT NULL,
  `invoice_id` INT NOT NULL,
  `provider` VARCHAR(30) NOT NULL DEFAULT 'tripay',
  `merchant_ref` VARCHAR(64) NOT NULL COMMENT 'Referensi internal yg dikirim ke gateway',
  `provider_ref` VARCHAR(100) DEFAULT NULL COMMENT 'Referensi dari gateway',
  `payment_method` VARCHAR(50) DEFAULT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `fee` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `status` ENUM('pending','paid','failed','expired','refunded') NOT NULL DEFAULT 'pending',
  `checkout_url` VARCHAR(500) DEFAULT NULL,
  `pay_code` VARCHAR(100) DEFAULT NULL,
  `expired_at` DATETIME DEFAULT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `raw_response` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_billing_payment_ref` (`merchant_ref`),
  KEY `idx_billing_payments_ws` (`workspace_id`),
  KEY `idx_billing_payments_invoice` (`invoice_id`),
  KEY `idx_billing_payments_status` (`status`),
  KEY `idx_billing_payments_provider_ref` (`provider_ref`),
  CONSTRAINT `fk_billing_payments_ws` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billing_payments_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
