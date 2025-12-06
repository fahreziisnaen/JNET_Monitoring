-- =====================================================
-- JNET MONITORING TOOLS - DATABASE SEEDER
-- =====================================================
-- This file contains seed data for the database
-- Run this after creating the schema
-- =====================================================

USE `jnet_monitoring`;

-- =====================================================
-- Admin User Seeder
-- =====================================================
-- Default admin credentials:
-- Username: admin
-- Password: admin123
-- 
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
    'https://api.dicebear.com/8.x/initials/svg?seed=Administrator',
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
    `main_interface`
)
SELECT 
    'Admin Workspace',
    @admin_user_id,
    NULL,
    0,
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
-- Seeder Complete
-- =====================================================
-- Admin user created with:
-- Username: admin
-- Password: admin123
-- 
-- Please change the password after first login!
-- =====================================================

