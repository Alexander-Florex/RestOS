-- Personalización de platos (tarea 5.7). Solo agrega: tablas nuevas y columnas
-- JSON opcionales. No modifica ni borra datos existentes.
-- Para revertir: DROP de menu_item_options y menu_item_option_groups, y
-- DROP COLUMN modifiers en order_items, takeaway_items y sale_items.

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `modifiers` JSON NULL;

-- AlterTable
ALTER TABLE `sale_items` ADD COLUMN `modifiers` JSON NULL;

-- AlterTable
ALTER TABLE `takeaway_items` ADD COLUMN `modifiers` JSON NULL;

-- CreateTable
CREATE TABLE `menu_item_option_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `menuItemId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('REMOVE', 'SINGLE', 'MULTI') NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `menu_item_option_groups_restaurantId_idx`(`restaurantId`),
    INDEX `menu_item_option_groups_menuItemId_idx`(`menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `menu_item_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `priceDelta` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `menu_item_options_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `menu_item_option_groups` ADD CONSTRAINT `menu_item_option_groups_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_item_option_groups` ADD CONSTRAINT `menu_item_option_groups_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_item_options` ADD CONSTRAINT `menu_item_options_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `menu_item_option_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

