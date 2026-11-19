-- Comandera (tarea 1.1): trabajos de impresión con el ticket armado y su estado,
-- y ancho del papel por restaurante (80 mm por defecto). Aditiva.

-- AlterTable
ALTER TABLE `restaurants` ADD COLUMN `printPaperWidth` INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE `print_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `payload` JSON NOT NULL,
    `doc` JSON NOT NULL,
    `status` ENUM('PENDING', 'PRINTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(500) NULL,
    `reprintOfId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `printedAt` DATETIME(3) NULL,

    INDEX `print_jobs_restaurantId_createdAt_idx`(`restaurantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

