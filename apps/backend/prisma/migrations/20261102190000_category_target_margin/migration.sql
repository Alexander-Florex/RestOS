-- Margen objetivo por categoría (tarea 2.6). Solo agrega una columna nula.
-- Para revertir: DROP COLUMN targetMargin.

-- AlterTable
ALTER TABLE `menu_categories` ADD COLUMN `targetMargin` DOUBLE NULL;

