-- Historial de pedidos (tarea 1.3). Solo agrega columnas: los pedidos que
-- existen hoy quedan como OPEN (los cobrados se borraban, así que no hay
-- pedidos cobrados para migrar).
-- Para revertir: DROP de las FKs/índices nuevos y de las columnas status,
-- saleId, closedAt, cancelReason y cancelledById de orders.

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `cancelReason` TEXT NULL,
    ADD COLUMN `cancelledById` INTEGER NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `saleId` INTEGER NULL,
    ADD COLUMN `status` ENUM('OPEN', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX `orders_tableId_status_idx` ON `orders`(`tableId`, `status`);

-- CreateIndex
CREATE INDEX `orders_saleId_idx` ON `orders`(`saleId`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

