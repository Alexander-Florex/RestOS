-- Unidades (tarea 2.1): equivalencia opcional entre familias por insumo
-- (ej. 1 un = 60 g). Solo agrega columnas nulas.
-- Para revertir: DROP COLUMN equivalenceQty y equivalenceUnit.

-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `equivalenceQty` DOUBLE NULL,
    ADD COLUMN `equivalenceUnit` VARCHAR(191) NULL;

