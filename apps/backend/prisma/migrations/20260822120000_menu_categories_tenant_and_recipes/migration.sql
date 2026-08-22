-- Corrective: la migración 20260811215602_add_menu_categories creó `menu_categories`
-- sin `restaurantId`, rompiendo el aislamiento multi-tenant (unique global por `name`).
-- Se vacía y reconstruye scoped por restaurante a partir de las categorías realmente
-- usadas en `menu_items`.

-- 1. Vaciar filas globales (sin tenant) — se reconstruyen abajo, ya scoped
DELETE FROM `menu_categories`;

-- 2. Agregar columnas de tenant + orden/color
ALTER TABLE `menu_categories`
  ADD COLUMN `restaurantId` INTEGER NOT NULL,
  ADD COLUMN `color` VARCHAR(191) NOT NULL DEFAULT '#10b981',
  ADD COLUMN `order` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- 3. Reemplazar el unique global por uno scoped por restaurante
DROP INDEX `menu_categories_name_key` ON `menu_categories`;
CREATE UNIQUE INDEX `menu_categories_restaurantId_name_key` ON `menu_categories`(`restaurantId`, `name`);
CREATE INDEX `menu_categories_restaurantId_idx` ON `menu_categories`(`restaurantId`);

-- 4. FK al tenant
ALTER TABLE `menu_categories`
  ADD CONSTRAINT `menu_categories_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Backfill: una categoría por cada (restaurantId, category) realmente usado
INSERT INTO `menu_categories` (`restaurantId`, `name`, `color`, `order`)
SELECT DISTINCT `restaurantId`, `category`, '#10b981', 0 FROM `menu_items`;

-- ──────────────────────────────────────────────
-- Recetas y costos
-- ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE `recipes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `menuItemId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `yield` INTEGER NOT NULL DEFAULT 1,
    `profitPct` DOUBLE NOT NULL DEFAULT 0.5,
    `vatPct` DOUBLE NOT NULL DEFAULT 0.21,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `recipes_restaurantId_idx`(`restaurantId`),
    INDEX `recipes_menuItemId_idx`(`menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recipe_ingredients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recipeId` INTEGER NOT NULL,
    `inventoryItemId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `unit` VARCHAR(191) NOT NULL,

    INDEX `recipe_ingredients_recipeId_idx`(`recipeId`),
    INDEX `recipe_ingredients_inventoryItemId_idx`(`inventoryItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipes` ADD CONSTRAINT `recipes_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipe_ingredients` ADD CONSTRAINT `recipe_ingredients_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipe_ingredients` ADD CONSTRAINT `recipe_ingredients_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
