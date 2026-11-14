-- Mesas con nombre (aditiva). El número sigue siendo el identificador de la mesa
-- en ventas y reportes; el nombre es opcional y único por restaurante.
ALTER TABLE `restaurants` ADD COLUMN `tableLabelMode` ENUM('NAME', 'NUMBER') NOT NULL DEFAULT 'NAME';

-- Copia del nombre de la mesa en la venta
ALTER TABLE `sales` ADD COLUMN `tableName` VARCHAR(120) NULL;

ALTER TABLE `tables` ADD COLUMN `name` VARCHAR(40) NULL;
CREATE UNIQUE INDEX `tables_restaurantId_name_key` ON `tables`(`restaurantId`, `name`);
