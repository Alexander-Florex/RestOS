-- Agrega el costo por unidad al inventario, base para el cálculo de costos de recetas.
ALTER TABLE `inventory_items`
  ADD COLUMN `costPerUnit` DECIMAL(10, 4) NOT NULL DEFAULT 0;
