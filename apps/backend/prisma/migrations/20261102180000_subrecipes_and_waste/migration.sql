-- Sub-recetas (tarea 2.3) y merma por línea (tarea 2.4).
-- Una línea de receta pasa a ser un insumo O una sub-receta: inventoryItemId
-- admite NULL y se agrega subRecipeId. Las líneas existentes son todas de insumo
-- y siguen igual. Rendimiento en unidades (yieldQty/yieldUnit) en recipes.
-- Para revertir: DROP de la FK y el índice nuevos; DROP COLUMN subRecipeId, wastePct,
-- yieldQty, yieldUnit; volver inventoryItemId a NOT NULL (si no hay sub-recetas).

-- AlterTable
ALTER TABLE `recipe_ingredients` ADD COLUMN `subRecipeId` INTEGER NULL,
    ADD COLUMN `wastePct` DOUBLE NULL,
    MODIFY `inventoryItemId` INTEGER NULL;

-- AlterTable
ALTER TABLE `recipes` ADD COLUMN `yieldQty` DOUBLE NULL,
    ADD COLUMN `yieldUnit` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `recipe_ingredients_subRecipeId_idx` ON `recipe_ingredients`(`subRecipeId`);

-- AddForeignKey
ALTER TABLE `recipe_ingredients` ADD CONSTRAINT `recipe_ingredients_subRecipeId_fkey` FOREIGN KEY (`subRecipeId`) REFERENCES `recipes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- "Insumo o sub-receta, exactamente uno" lo valida la app (recipes.service.ts):
-- MySQL no admite un CHECK sobre columnas con FK ON UPDATE CASCADE.
