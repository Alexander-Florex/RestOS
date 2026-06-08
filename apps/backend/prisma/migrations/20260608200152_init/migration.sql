-- AlterTable
ALTER TABLE `staff_members` ADD COLUMN `cuit` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tables` ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `sectionId` INTEGER NULL;

-- CreateTable
CREATE TABLE `sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#64748b',
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sections_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `tables_sectionId_idx` ON `tables`(`sectionId`);

-- AddForeignKey
ALTER TABLE `tables` ADD CONSTRAINT `tables_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
