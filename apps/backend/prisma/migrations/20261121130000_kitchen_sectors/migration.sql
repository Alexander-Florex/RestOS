-- Sectores de cocina: cada categoría tiene el suyo y un plato puntual puede cambiarlo.
-- Aditiva: todo arranca en caliente y ningún plato deja de salir en la comanda.
ALTER TABLE `menu_categories` ADD COLUMN `kitchenSector` ENUM('HOT', 'COLD') NOT NULL DEFAULT 'HOT';

-- NULL = usa el sector de su categoría
ALTER TABLE `menu_items` ADD COLUMN `kitchenSector` ENUM('HOT', 'COLD') NULL;
