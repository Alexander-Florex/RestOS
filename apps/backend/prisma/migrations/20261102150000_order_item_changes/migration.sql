-- Cambios de platos (tarea 5.8). Agrega el estado de cada ítem (ACTIVE por
-- defecto: los ítems existentes se siguen cobrando igual) y la tabla de cambios.
-- Además le suma al rol de sistema Cajero el permiso para autorizar cambios.
-- Para revertir: DROP TABLE order_item_changes; DROP COLUMN status, voidedAt y
-- voidReason de order_items; quitar orders.change.approve de los roles.

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `status` ENUM('ACTIVE', 'VOIDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `voidReason` TEXT NULL,
    ADD COLUMN `voidedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `order_item_changes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `type` ENUM('REMAKE', 'REPLACE') NOT NULL,
    `status` ENUM('PENDING', 'APPLIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `quantity` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `fault` ENUM('KITCHEN', 'WAITER', 'CUSTOMER', 'OTHER') NULL,
    `wasPrepared` BOOLEAN NOT NULL DEFAULT false,
    `itemSnapshot` JSON NOT NULL,
    `replacementMenuItemId` INTEGER NULL,
    `replacementOptionIds` JSON NULL,
    `replacementNotes` TEXT NULL,
    `newOrderItemId` INTEGER NULL,
    `voidedOrderItemId` INTEGER NULL,
    `requestedById` INTEGER NULL,
    `resolvedById` INTEGER NULL,
    `rejectReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `order_item_changes_restaurantId_status_idx`(`restaurantId`, `status`),
    INDEX `order_item_changes_restaurantId_createdAt_idx`(`restaurantId`, `createdAt`),
    INDEX `order_item_changes_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Permiso nuevo para el Cajero (los roles se guardan con su lista de permisos)
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'orders.change.approve')
WHERE `key` = 'CASHIER' AND NOT JSON_CONTAINS(`permissions`, '"orders.change.approve"');
