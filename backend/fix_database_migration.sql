-- =====================================================
-- FIX: Add device_id column to resource_logs if not exists
-- =====================================================
-- Run this script to fix the database schema
-- Command: mysql -u root -p < backend/fix_database_migration.sql
-- =====================================================

USE `jnet_monitoring`;

-- Check if device_id column exists
SET @col_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resource_logs' 
    AND COLUMN_NAME = 'device_id'
);

-- Add column if it doesn't exist
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE `resource_logs` ADD COLUMN `device_id` INT NOT NULL AFTER `workspace_id`',
    'SELECT "Column device_id already exists" AS skip_message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if index exists
SET @idx_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resource_logs' 
    AND INDEX_NAME = 'idx_workspace_device_timestamp'
);

-- Add index if it doesn't exist
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE `resource_logs` ADD INDEX `idx_workspace_device_timestamp` (`workspace_id`, `device_id`, `timestamp`)',
    'SELECT "Index idx_workspace_device_timestamp already exists" AS skip_message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if foreign key exists
SET @fk_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'resource_logs' 
    AND CONSTRAINT_NAME = 'fk_resource_logs_device'
);

-- Add foreign key if it doesn't exist
SET @sql = IF(@fk_exists = 0,
    'ALTER TABLE `resource_logs` ADD CONSTRAINT `fk_resource_logs_device` FOREIGN KEY (`device_id`) REFERENCES `mikrotik_devices`(`id`) ON DELETE CASCADE',
    'SELECT "Foreign key fk_resource_logs_device already exists" AS skip_message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- Fix Complete
-- =====================================================
SELECT 
    'Migration complete!' AS status,
    'device_id column, index, and foreign key have been added to resource_logs table.' AS message;

