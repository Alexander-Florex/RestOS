-- Pagos (tarea 5.2, aditiva): varios medios por venta (sale_payments), descuento con motivo
-- y promo de efectivo configurable por restaurante.
-- AlterTable
ALTER TABLE `account_payments` MODIFY `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT', 'MIXED') NOT NULL;

-- AlterTable
ALTER TABLE `restaurants` ADD COLUMN `cashPromoDays` VARCHAR(20) NOT NULL DEFAULT '3,4,5',
    ADD COLUMN `cashPromoPct` DECIMAL(5, 2) NULL DEFAULT 10;

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `discount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `discountPct` DECIMAL(5, 2) NULL,
    ADD COLUMN `discountReason` VARCHAR(200) NULL,
    ADD COLUMN `subtotal` DECIMAL(10, 2) NULL,
    MODIFY `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT', 'MIXED') NOT NULL;

-- AlterTable
ALTER TABLE `takeaway_orders` MODIFY `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT', 'MIXED') NULL;

-- CreateTable
CREATE TABLE `sale_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `method` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT', 'MIXED') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `tendered` DECIMAL(10, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_payments_saleId_idx`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sale_payments` ADD CONSTRAINT `sale_payments_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Ventas anteriores: un pago por venta, con lo cobrado (sin vuelto). Las a cuenta no tienen pago.
INSERT INTO `sale_payments` (`saleId`, `method`, `amount`, `tendered`, `createdAt`)
SELECT `id`, `paymentMethod`, LEAST(`amount`, `total`),
       CASE WHEN `paymentMethod` = 'CASH' THEN `amount` ELSE NULL END, `closedAt`
FROM `sales` WHERE `paymentMethod` <> 'ACCOUNT';

-- Permiso nuevo para el Cajero: aplicar descuentos (con motivo)
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'sales.discount')
WHERE `key` = 'CASHIER' AND NOT JSON_CONTAINS(`permissions`, '"sales.discount"');
