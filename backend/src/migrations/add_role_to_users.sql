-- Migration to add role column to users table
USE `jnet_monitoring`;

ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `role` ENUM('admin', 'user') DEFAULT 'admin' AFTER `profile_picture_url`;

-- Ensure all existing users are admins (since they currently own their workspaces)
UPDATE `users` SET `role` = 'admin' WHERE `role` IS NULL;
