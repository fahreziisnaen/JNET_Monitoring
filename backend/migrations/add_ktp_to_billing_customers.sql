ALTER TABLE `billing_customers`
  ADD COLUMN `ktp_number` VARCHAR(32) DEFAULT NULL COMMENT 'No. KTP pelanggan (opsional)' AFTER `name`;
