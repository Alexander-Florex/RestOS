-- Fix: la migración 20260613000000_multitenant ya estaba marcada como aplicada
-- antes de que se agregaran las líneas de takeaway_orders, por lo que esas
-- líneas nunca se ejecutaron. Esta migración agrega lo que falta.

ALTER TABLE `takeaway_orders` ADD COLUMN `restaurantId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `takeaway_orders` ALTER COLUMN `restaurantId` DROP DEFAULT;
CREATE INDEX `takeaway_orders_restaurantId_idx` ON `takeaway_orders`(`restaurantId`);
ALTER TABLE `takeaway_orders` ADD CONSTRAINT `takeaway_orders_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;