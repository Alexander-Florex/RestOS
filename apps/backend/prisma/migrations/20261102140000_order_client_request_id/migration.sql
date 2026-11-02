-- Pedidos sin conexión (tarea 1.5): id del dispositivo para no duplicar pedidos
-- reintentados. Solo agrega columnas opcionales e índices únicos (NULL no choca).
-- Para revertir: DROP INDEX de los dos únicos y DROP COLUMN clientRequestId.

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `clientRequestId` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `takeaway_orders` ADD COLUMN `clientRequestId` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `orders_restaurantId_clientRequestId_key` ON `orders`(`restaurantId`, `clientRequestId`);

-- CreateIndex
CREATE UNIQUE INDEX `takeaway_orders_restaurantId_clientRequestId_key` ON `takeaway_orders`(`restaurantId`, `clientRequestId`);

