-- Mesas unidas (aditiva): las mesas de un grupo comparten groupId.
-- AlterTable
ALTER TABLE `tables` ADD COLUMN `groupId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `tables_restaurantId_groupId_idx` ON `tables`(`restaurantId`, `groupId`);

