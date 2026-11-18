-- Stock (fase 3, aditiva): descuento al vender (apagado por defecto), elaborados con stock
-- propio, proveedores y estado del menú según stock.
-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `supplierId` INTEGER NULL;

-- AlterTable
ALTER TABLE `menu_items` ADD COLUMN `stockAuto` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `recipes` ADD COLUMN `stockItemId` INTEGER NULL;

-- AlterTable
ALTER TABLE `restaurants` ADD COLUMN `autoStockOnSale` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(50) NULL,
    `email` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `suppliers_restaurantId_name_key`(`restaurantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `recipes_stockItemId_key` ON `recipes`(`stockItemId`);

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_stockItemId_fkey` FOREIGN KEY (`stockItemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Proveedores: se crean desde el texto libre que ya tenían los insumos y se vinculan
INSERT INTO `suppliers` (`restaurantId`, `name`, `updatedAt`)
SELECT DISTINCT `restaurantId`, LEFT(TRIM(`supplier`), 120), CURRENT_TIMESTAMP(3)
FROM `inventory_items` WHERE `supplier` IS NOT NULL AND TRIM(`supplier`) <> '';
UPDATE `inventory_items` i JOIN `suppliers` s
  ON s.`restaurantId` = i.`restaurantId` AND s.`name` = LEFT(TRIM(i.`supplier`), 120)
SET i.`supplierId` = s.`id`;
