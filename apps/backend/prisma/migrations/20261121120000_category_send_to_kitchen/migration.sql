-- Qué categorías de la carta salen en la comanda de cocina.
-- Aditiva: todas siguen saliendo, salvo las de bebidas.
ALTER TABLE `menu_categories` ADD COLUMN `sendToKitchen` BOOLEAN NOT NULL DEFAULT true;

UPDATE `menu_categories`
SET `sendToKitchen` = false
WHERE LOWER(TRIM(`name`)) IN ('bebida', 'bebidas', 'drinks');
