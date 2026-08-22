-- CreateTable
CREATE TABLE `menu_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `menu_categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: registrar como categoría real cada categoría ya usada por algún item existente
INSERT INTO `menu_categories` (`name`)
SELECT DISTINCT `category` FROM `menu_items`;

-- Limpieza: borrar los items "placeholder" creados por el hack anterior para simular
-- categorías vacías (nombre "[Placeholder ...]", precio 0, deshabilitados)
DELETE FROM `menu_items`
WHERE `enabled` = false
  AND `price` = 0
  AND `name` LIKE '[Placeholder %]';
