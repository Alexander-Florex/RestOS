-- Tarea 1.1 (parte 2): impresora de la comandera, reintentos y descartar.
-- Aditiva: columnas nuevas con valor por defecto y un valor más en el enum.

-- AlterTable
ALTER TABLE `print_jobs` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `status` ENUM('PENDING', 'PRINTED', 'FAILED', 'DISCARDED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `restaurants` ADD COLUMN `printerName` VARCHAR(120) NULL;

-- CreateIndex
CREATE INDEX `print_jobs_status_queuedAt_idx` ON `print_jobs`(`status`, `queuedAt`);


-- Los trabajos que ya estaban: esperan desde que se crearon
UPDATE `print_jobs` SET `queuedAt` = `createdAt`;
