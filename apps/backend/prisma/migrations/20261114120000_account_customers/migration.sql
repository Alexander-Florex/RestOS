-- Cuenta corriente (tarea 5.9, aditiva): medio de pago ACCOUNT, clientes con cuenta,
-- cobros de deuda (con recargo aparte) y en cada venta a cuenta, de quién es y qué cobro la saldó.
-- AlterTable
ALTER TABLE `sales` ADD COLUMN `accountPaymentId` INTEGER NULL,
    ADD COLUMN `customerId` INTEGER NULL,
    MODIFY `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT') NOT NULL;

-- AlterTable
ALTER TABLE `takeaway_orders` MODIFY `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT') NULL;

-- CreateTable
CREATE TABLE `account_customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `cuit` VARCHAR(20) NULL,
    `contact` VARCHAR(200) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `account_customers_restaurantId_name_key`(`restaurantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `debt` DECIMAL(10, 2) NOT NULL,
    `surchargePct` DECIMAL(5, 2) NOT NULL,
    `surcharge` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'CARD', 'TRANSFER', 'ACCOUNT') NOT NULL,
    `notes` VARCHAR(500) NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `registeredById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_payments_restaurantId_paidAt_idx`(`restaurantId`, `paidAt`),
    INDEX `account_payments_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `account_customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_accountPaymentId_fkey` FOREIGN KEY (`accountPaymentId`) REFERENCES `account_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_customers` ADD CONSTRAINT `account_customers_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_payments` ADD CONSTRAINT `account_payments_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_payments` ADD CONSTRAINT `account_payments_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `account_customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_payments` ADD CONSTRAINT `account_payments_registeredById_fkey` FOREIGN KEY (`registeredById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Permiso nuevo para el Cajero: dejar mesas a cuenta y registrar cobros (el Administrador ya tiene todos)
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'accounts.manage')
WHERE `key` = 'CASHIER' AND NOT JSON_CONTAINS(`permissions`, '"accounts.manage"');
