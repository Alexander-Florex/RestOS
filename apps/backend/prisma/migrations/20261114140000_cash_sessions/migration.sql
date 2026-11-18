-- Caja (tarea 5.1, aditiva): una sola caja abierta por local (openKey único), apertura,
-- ingresos/egresos de efectivo y cierre con arqueo.
-- CreateTable
CREATE TABLE `cash_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `openedById` INTEGER NULL,
    `openingAmount` DECIMAL(10, 2) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` INTEGER NULL,
    `expectedCash` DECIMAL(10, 2) NULL,
    `countedCash` DECIMAL(10, 2) NULL,
    `difference` DECIMAL(10, 2) NULL,
    `closeNotes` VARCHAR(500) NULL,
    `summary` JSON NULL,
    `openKey` INTEGER NULL,

    UNIQUE INDEX `cash_sessions_openKey_key`(`openKey`),
    INDEX `cash_sessions_restaurantId_openedAt_idx`(`restaurantId`, `openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `type` ENUM('IN', 'OUT') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_movements_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_sessions` ADD CONSTRAINT `cash_sessions_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_sessions` ADD CONSTRAINT `cash_sessions_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_sessions` ADD CONSTRAINT `cash_sessions_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_movements` ADD CONSTRAINT `cash_movements_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `cash_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_movements` ADD CONSTRAINT `cash_movements_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Permiso nuevo para el Cajero: abrir/cerrar caja y registrar ingresos/egresos
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'cash.manage')
WHERE `key` = 'CASHIER' AND NOT JSON_CONTAINS(`permissions`, '"cash.manage"');
