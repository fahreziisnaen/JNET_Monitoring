-- =====================================================
-- JNET MONITORING TOOLS - DATABASE SCHEMA
-- =====================================================
-- This file contains the complete database schema
-- for the JNET Monitoring application.
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
  `main_interface` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
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
-- Additional Tables (if needed)
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
-- Schema Creation Complete
-- =====================================================

