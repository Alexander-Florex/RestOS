-- Versión grande de un plato: vincula dos platos que ya existen (ej. César de entrada y César principal).
-- Aditiva: arranca vacía en todos los platos. Si se borra la versión grande, el vínculo queda en NULL.
ALTER TABLE `menu_items` ADD COLUMN `largeVersionId` INTEGER NULL;

CREATE UNIQUE INDEX `menu_items_largeVersionId_key` ON `menu_items`(`largeVersionId`);

ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_largeVersionId_fkey` FOREIGN KEY (`largeVersionId`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
