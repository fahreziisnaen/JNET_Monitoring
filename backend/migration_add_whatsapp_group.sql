-- Migration: Tambah kolom whatsapp_group_id untuk mengirim alert ke group WhatsApp
-- OTP tetap dikirim ke nomor individual masing-masing user

ALTER TABLE `workspaces` 
ADD COLUMN `whatsapp_group_id` VARCHAR(255) NULL 
COMMENT 'WhatsApp Group JID untuk mengirim alert ke group (format: 120363123456789012@g.us)' 
AFTER `whatsapp_bot_enabled`;

-- Index untuk performa query
CREATE INDEX `idx_whatsapp_group_id` ON `workspaces` (`whatsapp_group_id`);

