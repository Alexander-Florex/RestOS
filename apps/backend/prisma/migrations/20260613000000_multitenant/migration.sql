-- ──────────────────────────────────────────────
-- Multi-tenant: agrega tabla `restaurants` y columna
-- `restaurantId` a todas las entidades del negocio.
-- ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE `restaurants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Restaurante por defecto para datos existentes (id=1)
INSERT INTO `restaurants` (`id`, `name`, `createdAt`, `updatedAt`)
VALUES (1, 'Restaurante Principal', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- ──────────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────────
ALTER TABLE `users` DROP INDEX `users_username_key`;
ALTER TABLE `users` DROP INDEX `users_email_key`;
ALTER TABLE `users` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `users` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `users_restaurantId_idx` ON `users`(`restaurantId`);
CREATE UNIQUE INDEX `users_restaurantId_username_key` ON `users`(`restaurantId`, `username`);
CREATE UNIQUE INDEX `users_restaurantId_email_key` ON `users`(`restaurantId`, `email`);
ALTER TABLE `users` ADD CONSTRAINT `users_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- SECTIONS
-- ──────────────────────────────────────────────
ALTER TABLE `sections` DROP INDEX `sections_name_key`;
ALTER TABLE `sections` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `sections` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `sections_restaurantId_idx` ON `sections`(`restaurantId`);
CREATE UNIQUE INDEX `sections_restaurantId_name_key` ON `sections`(`restaurantId`, `name`);
ALTER TABLE `sections` ADD CONSTRAINT `sections_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- TABLES
-- ──────────────────────────────────────────────
ALTER TABLE `tables` DROP INDEX `tables_number_key`;
ALTER TABLE `tables` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `tables` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `tables_restaurantId_idx` ON `tables`(`restaurantId`);
CREATE UNIQUE INDEX `tables_restaurantId_number_key` ON `tables`(`restaurantId`, `number`);
ALTER TABLE `tables` ADD CONSTRAINT `tables_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- MENU_ITEMS
-- ──────────────────────────────────────────────
ALTER TABLE `menu_items` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `menu_items` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `menu_items_restaurantId_idx` ON `menu_items`(`restaurantId`);
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- ORDERS
-- ──────────────────────────────────────────────
ALTER TABLE `orders` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `orders` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `orders_restaurantId_idx` ON `orders`(`restaurantId`);
ALTER TABLE `orders` ADD CONSTRAINT `orders_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- SALES
-- ──────────────────────────────────────────────
ALTER TABLE `sales` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `sales` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `sales_restaurantId_idx` ON `sales`(`restaurantId`);
ALTER TABLE `sales` ADD CONSTRAINT `sales_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- INVENTORY_ITEMS
-- ──────────────────────────────────────────────
ALTER TABLE `inventory_items` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `inventory_items` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `inventory_items_restaurantId_idx` ON `inventory_items`(`restaurantId`);
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- STAFF_MEMBERS
-- ──────────────────────────────────────────────
ALTER TABLE `staff_members` DROP INDEX `staff_members_email_key`;
ALTER TABLE `staff_members` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `staff_members` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `staff_members_restaurantId_idx` ON `staff_members`(`restaurantId`);
CREATE UNIQUE INDEX `staff_members_restaurantId_email_key` ON `staff_members`(`restaurantId`, `email`);
ALTER TABLE `staff_members` ADD CONSTRAINT `staff_members_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- RESERVATIONS
-- ──────────────────────────────────────────────
ALTER TABLE `reservations` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `reservations` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `reservations_restaurantId_idx` ON `reservations`(`restaurantId`);
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
