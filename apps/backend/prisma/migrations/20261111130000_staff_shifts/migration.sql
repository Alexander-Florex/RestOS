-- Horarios del personal (aditiva): valor por hora del empleado y turnos marcados
-- (entrada/salida). Un solo turno abierto por persona (openKey único).
-- AlterTable
ALTER TABLE `staff_members` ADD COLUMN `hourlyRate` DECIMAL(10, 2) NULL;

-- CreateTable
CREATE TABLE `staff_shifts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `restaurantId` INTEGER NOT NULL,
    `staffMemberId` INTEGER NOT NULL,
    `clockIn` DATETIME(3) NOT NULL,
    `clockOut` DATETIME(3) NULL,
    `hourlyRate` DECIMAL(10, 2) NULL,
    `note` VARCHAR(200) NULL,
    `openKey` INTEGER NULL,
    `recordedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_shifts_openKey_key`(`openKey`),
    INDEX `staff_shifts_restaurantId_clockIn_idx`(`restaurantId`, `clockIn`),
    INDEX `staff_shifts_staffMemberId_clockIn_idx`(`staffMemberId`, `clockIn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `staff_shifts` ADD CONSTRAINT `staff_shifts_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_shifts` ADD CONSTRAINT `staff_shifts_staffMemberId_fkey` FOREIGN KEY (`staffMemberId`) REFERENCES `staff_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_shifts` ADD CONSTRAINT `staff_shifts_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

