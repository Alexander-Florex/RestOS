-- Roles configurables por restaurante (Administrador, Mesero, Cajero + los que cree el admin).
-- Migración aditiva: users.role (enum) se conserva y se mantiene sincronizado desde la app.
-- Reversión: DROP FOREIGN KEY users_roleId_fkey; DROP COLUMN users.roleId; DROP TABLE roles.

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NULL,
    `permissions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `roles_restaurantId_idx`(`restaurantId`),
    UNIQUE INDEX `roles_restaurantId_name_key`(`restaurantId`, `name`),
    UNIQUE INDEX `roles_restaurantId_key_key`(`restaurantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `roleId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `users_roleId_idx` ON `users`(`roleId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Roles de sistema para cada restaurante existente (mismos valores que SYSTEM_ROLES en src/lib/permissions.ts).
-- El permiso de cobrar (sales.charge) queda solo para Administrador y Cajero.
INSERT INTO `roles` (`restaurantId`, `name`, `key`, `permissions`, `updatedAt`)
SELECT `id`, 'Administrador', 'ADMIN', JSON_ARRAY(
  'app.dashboard','orders.create','orders.view','orders.delete','tables.operate','reservations.manage',
  'sales.charge','takeaway.cancel','sales.view','reports.view','menu.availability','menu.manage',
  'inventory.view','inventory.adjust','inventory.manage','recipes.manage','tables.manage',
  'takeaway.delete','staff.manage','users.manage'), CURRENT_TIMESTAMP(3)
FROM `restaurants`;

INSERT INTO `roles` (`restaurantId`, `name`, `key`, `permissions`, `updatedAt`)
SELECT `id`, 'Mesero', 'WAITER', JSON_ARRAY('orders.create'), CURRENT_TIMESTAMP(3)
FROM `restaurants`;

INSERT INTO `roles` (`restaurantId`, `name`, `key`, `permissions`, `updatedAt`)
SELECT `id`, 'Cajero', 'CASHIER', JSON_ARRAY(
  'app.dashboard','orders.create','orders.view','orders.delete','tables.operate','reservations.manage',
  'sales.charge','takeaway.cancel','sales.view','reports.view','menu.availability',
  'inventory.view','inventory.adjust'), CURRENT_TIMESTAMP(3)
FROM `restaurants`;

-- Asignar cada usuario existente a su rol: ADMIN → Administrador, WAITER → Mesero, STAFF → Cajero.
UPDATE `users` u
JOIN `roles` r ON r.`restaurantId` = u.`restaurantId`
 AND r.`key` = CASE u.`role` WHEN 'ADMIN' THEN 'ADMIN' WHEN 'WAITER' THEN 'WAITER' ELSE 'CASHIER' END
SET u.`roleId` = r.`id`;
