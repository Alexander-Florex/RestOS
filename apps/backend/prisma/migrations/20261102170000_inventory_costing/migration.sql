-- Costos de insumos (tareas 2.2, 2.4 y 2.5): presentación de compra, merma por
-- defecto e historial de precios. Solo agrega columnas (nulas o con default) y una tabla.
-- Para revertir: DROP TABLE price_history; DROP COLUMN purchaseQty, purchaseUnit,
-- purchasePrice y wastePct de inventory_items.

-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `purchasePrice` DECIMAL(12, 2) NULL,
    ADD COLUMN `purchaseQty` DOUBLE NULL,
    ADD COLUMN `purchaseUnit` VARCHAR(191) NULL,
    ADD COLUMN `wastePct` DOUBLE NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `price_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `inventoryItemId` INTEGER NOT NULL,
    `costPerUnit` DECIMAL(10, 4) NOT NULL,
    `previousCost` DECIMAL(10, 4) NULL,
    `unit` VARCHAR(191) NOT NULL,
    `purchaseQty` DOUBLE NULL,
    `purchaseUnit` VARCHAR(191) NULL,
    `purchasePrice` DECIMAL(12, 2) NULL,
    `source` ENUM('MANUAL', 'PURCHASE', 'IMPORT') NOT NULL DEFAULT 'MANUAL',
    `userId` INTEGER NULL,
    `userName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `price_history_inventoryItemId_createdAt_idx`(`inventoryItemId`, `createdAt`),
    INDEX `price_history_restaurantId_createdAt_idx`(`restaurantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

