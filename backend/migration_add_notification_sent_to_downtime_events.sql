-- Migration: Tambahkan kolom notification_sent ke tabel downtime_events
-- Untuk track apakah notifikasi disconnect sudah dikirim setelah 2 menit downtime

ALTER TABLE `downtime_events` 
ADD COLUMN `notification_sent` BOOLEAN DEFAULT FALSE AFTER `duration_seconds`;

-- Update semua downtime events yang sudah selesai (end_time IS NOT NULL) menjadi notification_sent = TRUE
-- karena mereka sudah tidak perlu dikirim notifikasi lagi
UPDATE `downtime_events` 
SET `notification_sent` = TRUE 
WHERE `end_time` IS NOT NULL;

