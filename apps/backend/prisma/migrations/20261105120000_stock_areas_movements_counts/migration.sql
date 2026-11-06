-- Stock real (tareas 3.1, 3.2 y 3.3): sectores de guardado, movimientos de stock
-- y tomas de inventario. Solo agrega tablas y dos columnas (nula / con default).
-- Datos: crea los 7 sectores de la planilla del cliente en cada restaurante y un
-- movimiento de "saldo inicial" por cada insumo con stock, así la suma de
-- movimientos coincide con inventory_items.quantity desde el primer día.
-- Para revertir: DROP TABLE stock_count_lines, stock_counts, stock_movements;
-- quitar la FK y las columnas storageAreaId y countOrder de inventory_items;
-- DROP TABLE storage_areas.

-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `countOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `storageAreaId` INTEGER NULL;

-- CreateTable
CREATE TABLE `storage_areas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `storage_areas_restaurantId_name_key`(`restaurantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `inventoryItemId` INTEGER NOT NULL,
    `type` ENUM('PURCHASE', 'SALE', 'PRODUCTION', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'COUNT') NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `balanceAfter` DOUBLE NOT NULL,
    `unitCost` DECIMAL(10, 4) NULL,
    `reason` VARCHAR(500) NULL,
    `reference` VARCHAR(100) NULL,
    `stockCountId` INTEGER NULL,
    `userId` INTEGER NULL,
    `userName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_inventoryItemId_createdAt_idx`(`inventoryItemId`, `createdAt`),
    INDEX `stock_movements_restaurantId_createdAt_idx`(`restaurantId`, `createdAt`),
    INDEX `stock_movements_stockCountId_idx`(`stockCountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_counts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `storageAreaId` INTEGER NULL,
    `areaName` VARCHAR(100) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `openKey` VARCHAR(30) NULL,
    `notes` VARCHAR(1000) NULL,
    `startedById` INTEGER NULL,
    `startedByName` VARCHAR(191) NULL,
    `closedById` INTEGER NULL,
    `closedByName` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    INDEX `stock_counts_restaurantId_startedAt_idx`(`restaurantId`, `startedAt`),
    UNIQUE INDEX `stock_counts_restaurantId_openKey_key`(`restaurantId`, `openKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stockCountId` INTEGER NOT NULL,
    `inventoryItemId` INTEGER NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `countedQty` DOUBLE NULL,
    `countedAt` DATETIME(3) NULL,
    `countedByName` VARCHAR(191) NULL,
    `expectedQty` DOUBLE NULL,
    `difference` DOUBLE NULL,
    `unitCost` DECIMAL(10, 4) NULL,
    `reason` VARCHAR(300) NULL,

    INDEX `stock_count_lines_stockCountId_position_idx`(`stockCountId`, `position`),
    UNIQUE INDEX `stock_count_lines_stockCountId_inventoryItemId_key`(`stockCountId`, `inventoryItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `inventory_items_storageAreaId_idx` ON `inventory_items`(`storageAreaId`);

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_storageAreaId_fkey` FOREIGN KEY (`storageAreaId`) REFERENCES `storage_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_areas` ADD CONSTRAINT `storage_areas_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_storageAreaId_fkey` FOREIGN KEY (`storageAreaId`) REFERENCES `storage_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_lines` ADD CONSTRAINT `stock_count_lines_stockCountId_fkey` FOREIGN KEY (`stockCountId`) REFERENCES `stock_counts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_lines` ADD CONSTRAINT `stock_count_lines_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Sectores de la planilla de stock del cliente (sección 7.1 de CLAUDE.md)
INSERT INTO `storage_areas` (`restaurantId`, `name`, `sortOrder`, `updatedAt`)
SELECT r.`id`, v.`name`, v.`ord`, CURRENT_TIMESTAMP(3)
FROM `restaurants` r
CROSS JOIN (
              SELECT 'Carnes, pescados y mariscos' AS `name`, 1 AS `ord`
    UNION ALL SELECT 'Pastas', 2
    UNION ALL SELECT 'Guarniciones y salsas', 3
    UNION ALL SELECT 'Cámara / heladera', 4
    UNION ALL SELECT 'Vegetales en depósito', 5
    UNION ALL SELECT 'Estanterías depósito', 6
    UNION ALL SELECT 'Limpieza y descartables', 7
) v;

-- Saldo inicial: el stock que ya estaba cargado pasa a ser un movimiento
INSERT INTO `stock_movements` (`restaurantId`, `inventoryItemId`, `type`, `quantity`, `balanceAfter`, `unitCost`, `reason`, `createdAt`)
SELECT `restaurantId`, `id`, 'ADJUSTMENT', `quantity`, `quantity`, `costPerUnit`,
       'Saldo inicial (stock cargado antes de registrar movimientos)', CURRENT_TIMESTAMP(3)
FROM `inventory_items`
WHERE `quantity` <> 0;
