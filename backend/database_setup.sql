-- =====================================================
-- JNET MONITORING TOOLS - COMPLETE DATABASE SETUP
-- =====================================================
-- This file contains the complete database setup
-- including schema, migrations, and initial seeder
-- Run this file for initial deployment
-- =====================================================

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS `jnet_monitoring` 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

-- Use the database
USE `jnet_monitoring`;

-- Drop existing tables if they exist (in reverse dependency order)
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `dashboard_snapshot`;
DROP TABLE IF EXISTS `interface_traffic_logs`;
DROP TABLE IF EXISTS `resource_logs`;
DROP TABLE IF EXISTS `pppoe_usage_logs`;
DROP TABLE IF EXISTS `traffic_logs`;
DROP TABLE IF EXISTS `downtime_events`;
DROP TABLE IF EXISTS `pppoe_user_status`;
DROP TABLE IF EXISTS `workspace_invites`;
DROP TABLE IF EXISTS `clients`;
DROP TABLE IF EXISTS `odp_user_connections`;
DROP TABLE IF EXISTS `network_assets`;
DROP TABLE IF EXISTS `asset_owners`;
DROP TABLE IF EXISTS `ip_pools`;
DROP TABLE IF EXISTS `pending_registrations`;
DROP TABLE IF EXISTS `login_otps`;
DROP TABLE IF EXISTS `user_sessions`;
DROP TABLE IF EXISTS `mikrotik_devices`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `workspaces`;
DROP TABLE IF EXISTS `alarms`;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- Core Tables
-- =====================================================

CREATE TABLE `workspaces` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `owner_id` int NOT NULL,
  `active_device_id` int DEFAULT NULL,
  `whatsapp_bot_enabled` tinyint(1) DEFAULT '0',
  `whatsapp_group_id` varchar(255) DEFAULT NULL COMMENT 'WhatsApp Group JID untuk mengirim alert ke group (format: 120363123456789012@g.us)',
  `main_interface` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_whatsapp_group_id` (`whatsapp_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int DEFAULT NULL,
  `username` varchar(50) NOT NULL,
  `display_name` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `whatsapp_number` varchar(20) DEFAULT NULL,
  `profile_picture_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `whatsapp_number` (`whatsapp_number`),
  KEY `idx_workspace_id` (`workspace_id`),
  CONSTRAINT `fk_users_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `mikrotik_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `host` varchar(100) NOT NULL,
  `user` varchar(100) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `port` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_workspace_id` (`workspace_id`),
  CONSTRAINT `fk_devices_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Session & Authentication Tables
-- =====================================================

CREATE TABLE `user_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_id` varchar(255) NOT NULL,
  `user_agent` text,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_id` (`token_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `login_otps` (
  `user_id` int NOT NULL,
  `otp_code` varchar(10) NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_login_otps_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pending_registrations` (
  `whatsapp_number` varchar(20) NOT NULL,
  `username` varchar(50) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `otp_code` varchar(10) NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`whatsapp_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Feature-specific Tables
-- =====================================================

CREATE TABLE `ip_pools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `profile_name` varchar(100) NOT NULL,
  `ip_start` varchar(45) NOT NULL,
  `ip_end` varchar(45) NOT NULL,
  `gateway` varchar(45) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspace_profile` (`workspace_id`,`profile_name`),
  CONSTRAINT `fk_ip_pools_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `network_assets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `owner_name` varchar(255) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  -- Hierarki fisik: Mikrotik -> OLT -> ODC -> ODP
  `type` enum('Mikrotik','OLT','ODC','ODP') NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `description` text,
  `splitter_count` int DEFAULT NULL,
  `parent_asset_id` int DEFAULT NULL,
  `connection_status` enum('terpasang','rencana','maintenance','putus') DEFAULT 'terpasang',
  PRIMARY KEY (`id`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_parent_asset_id` (`parent_asset_id`),
  CONSTRAINT `fk_network_assets_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_network_assets_parent` FOREIGN KEY (`parent_asset_id`) REFERENCES `network_assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Clients Table (Migration: Add clients table)
-- =====================================================
-- Description: Tabel untuk menyimpan data client yang diambil dari PPPoE secret
-- Client dapat dihubungkan ke ODP dan memiliki koordinat untuk ditampilkan di map

CREATE TABLE `clients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `pppoe_secret_name` varchar(100) NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `odp_asset_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_pppoe_secret_per_workspace` (`workspace_id`, `pppoe_secret_name`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_odp_asset_id` (`odp_asset_id`),
  CONSTRAINT `fk_clients_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_clients_odp_asset` FOREIGN KEY (`odp_asset_id`) REFERENCES `network_assets` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `odp_user_connections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `asset_id` int NOT NULL,
  `pppoe_secret_name` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_asset_id` (`asset_id`),
  CONSTRAINT `fk_odp_connections_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_odp_connections_asset` FOREIGN KEY (`asset_id`) REFERENCES `network_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `downtime_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `pppoe_user` varchar(100) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime DEFAULT NULL,
  `duration_seconds` int DEFAULT NULL,
  `notification_sent` BOOLEAN DEFAULT FALSE COMMENT 'Untuk track apakah notifikasi disconnect sudah dikirim setelah 2 menit downtime',
  PRIMARY KEY (`id`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_pppoe_user` (`pppoe_user`),
  CONSTRAINT `fk_downtime_events_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pppoe_user_status` (
  `workspace_id` int NOT NULL,
  `pppoe_user` varchar(100) NOT NULL,
  `is_active` tinyint(1) DEFAULT '0',
  `last_seen_active` datetime DEFAULT NULL,
  PRIMARY KEY (`workspace_id`, `pppoe_user`),
  CONSTRAINT `fk_pppoe_status_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workspace_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `code` varchar(10) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_workspace_invites_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_workspace_invites_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Logging & Monitoring Tables
-- =====================================================

CREATE TABLE `traffic_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspace_id` int NOT NULL,
  `interface_name` varchar(255) NOT NULL,
  `tx_bytes` bigint NOT NULL,
  `rx_bytes` bigint NOT NULL,
  `tx_usage` bigint NOT NULL DEFAULT '0',
  `rx_usage` bigint NOT NULL DEFAULT '0',
  `active_users_pppoe` int NOT NULL,
  `active_users_hotspot` int NOT NULL,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_workspace_timestamp` (`workspace_id`,`timestamp`),
  KEY `idx_interface_name` (`interface_name`),
  CONSTRAINT `fk_traffic_logs_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pppoe_usage_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workspace_id` INT NOT NULL,
  `pppoe_user` VARCHAR(255) NOT NULL,
  `usage_date` DATE NOT NULL,
  `upload_bytes` BIGINT UNSIGNED DEFAULT 0,
  `download_bytes` BIGINT UNSIGNED DEFAULT 0,
  `total_bytes` BIGINT UNSIGNED DEFAULT 0,
  UNIQUE KEY `unique_usage` (`workspace_id`, `pppoe_user`, `usage_date`),
  KEY `idx_workspace_id` (`workspace_id`),
  KEY `idx_usage_date` (`usage_date`),
  CONSTRAINT `fk_pppoe_usage_logs_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `resource_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workspace_id` INT NOT NULL,
  `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cpu_load` INT NULL,
  `memory_usage` BIGINT NULL,
  INDEX `idx_workspace_timestamp` (`workspace_id`, `timestamp`),
  CONSTRAINT `fk_resource_logs_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `interface_traffic_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workspace_id` INT NOT NULL,
  `interface_name` VARCHAR(255) NOT NULL,
  `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rx_bytes` BIGINT UNSIGNED NULL,
  `tx_bytes` BIGINT UNSIGNED NULL,
  INDEX `idx_workspace_interface_timestamp` (`workspace_id`, `interface_name`, `timestamp`),
  CONSTRAINT `fk_interface_traffic_logs_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Additional Tables
-- =====================================================

CREATE TABLE `alarms` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workspace_id` INT NOT NULL,
  `type` ENUM('CPU_LOAD', 'DEVICE_OFFLINE', 'MEMORY_USAGE') NOT NULL,
  `threshold_mbps` INT DEFAULT NULL,
  `threshold_percent` INT DEFAULT NULL,
  `enabled` TINYINT(1) DEFAULT '1',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_workspace_id` (`workspace_id`),
  CONSTRAINT `fk_alarms_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dashboard_snapshot` (
  `workspace_id` INT NOT NULL,
  `device_id` INT NOT NULL,
  `resource` JSON,
  `traffic` JSON,
  `pppoe_active` JSON,
  `active_interfaces` JSON,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`, `device_id`),
  CONSTRAINT `fk_dashboard_snapshot_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dashboard_snapshot_device` FOREIGN KEY (`device_id`) REFERENCES `mikrotik_devices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Set Database Timezone
-- =====================================================
-- Set timezone to Asia/Jakarta (UTC+7)
-- This ensures OTP expiration and other time-based features work correctly

SET GLOBAL time_zone = '+07:00';
SET time_zone = '+07:00';

-- =====================================================
-- Initial Seeder
-- =====================================================
-- Creates default admin user and workspace
-- Default credentials:
-- Username: admin
-- Password: admin123
-- IMPORTANT: Change the password immediately after first login!
-- =====================================================

-- Check if admin user already exists
SET @admin_exists = (SELECT COUNT(*) FROM `users` WHERE `username` = 'admin');

-- Only insert if admin doesn't exist
INSERT INTO `users` (
    `username`,
    `display_name`,
    `password_hash`,
    `whatsapp_number`,
    `profile_picture_url`,
    `created_at`
)
SELECT 
    'admin',
    'Administrator',
    '$2b$10$L3bZT40YYqqb4RmADDKkkuvrj9Ok4ZOeEC2MMQyssNM9Ne/JB4cK6',
    NULL,
    '/public/uploads/avatars/default.jpg',
    NOW()
WHERE @admin_exists = 0;

-- Get admin user ID
SET @admin_user_id = (SELECT `id` FROM `users` WHERE `username` = 'admin' LIMIT 1);

-- Create default workspace for admin if it doesn't exist
INSERT INTO `workspaces` (
    `name`,
    `owner_id`,
    `active_device_id`,
    `whatsapp_bot_enabled`,
    `whatsapp_group_id`,
    `main_interface`
)
SELECT 
    'Admin Workspace',
    @admin_user_id,
    NULL,
    0,
    NULL,
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM `workspaces` WHERE `owner_id` = @admin_user_id
);

-- Update admin user to link to workspace
UPDATE `users` 
SET `workspace_id` = (
    SELECT `id` FROM `workspaces` WHERE `owner_id` = @admin_user_id LIMIT 1
)
WHERE `id` = @admin_user_id AND `workspace_id` IS NULL;

-- =====================================================
-- Database Setup Complete
-- =====================================================
-- All tables, migrations, and indexes have been created
-- Timezone has been set to Asia/Jakarta (UTC+7)
-- 
-- Next steps:
-- 1. Configure backend .env file
-- 2. Configure frontend .env.production file
-- 3. Start backend server: pm2 start server.js --name "jnet-backend"
-- 4. Build and start frontend: npm run build && pm2 start npm --name "jnet-monitoring" -- start
-- 5. Configure Apache2 reverse proxy
-- =====================================================

