-- Migration: Add clients table
-- Description: Tabel untuk menyimpan data client yang diambil dari PPPoE secret
-- Client dapat dihubungkan ke ODP dan memiliki koordinat untuk ditampilkan di map

USE `jnet_monitoring`;

CREATE TABLE IF NOT EXISTS `clients` (
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

