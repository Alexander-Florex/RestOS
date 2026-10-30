-- Ventas "para llevar" dentro de `sales` (tarea 0.3).
-- Aditiva: agrega `channel` y `takeawayOrderId`, y permite `tableNumber` vacío.
-- Las ventas existentes quedan como DINE_IN (salón), con su mesa intacta.
-- Además pasa a `sales` los pedidos para llevar que ya estaban cobrados,
-- para que entren en reportes, caja, CSV y ranking de platos.
--
-- Reversión (si hiciera falta):
--   DELETE FROM sales WHERE channel = 'TAKEAWAY';   -- borra también sus sale_items (cascade)
--   ALTER TABLE sales DROP FOREIGN KEY sales_takeawayOrderId_fkey;
--   ALTER TABLE sales DROP INDEX sales_takeawayOrderId_key, DROP INDEX sales_channel_idx,
--     DROP COLUMN takeawayOrderId, DROP COLUMN channel, MODIFY tableNumber INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `sales`
    ADD COLUMN `channel` ENUM('DINE_IN', 'TAKEAWAY') NOT NULL DEFAULT 'DINE_IN',
    ADD COLUMN `takeawayOrderId` INTEGER NULL,
    MODIFY `tableNumber` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `sales_takeawayOrderId_key` ON `sales`(`takeawayOrderId`);
CREATE INDEX `sales_channel_idx` ON `sales`(`channel`);

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_takeawayOrderId_fkey` FOREIGN KEY (`takeawayOrderId`) REFERENCES `takeaway_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Traspaso de pedidos para llevar ya cobrados ──
-- Total: el guardado, o la suma de los ítems en pedidos viejos sin total.
-- Monto: lo recibido, o el total si no quedó registrado.
-- Fecha: la de cobro, o la última modificación si falta.
-- No se sabe quién cobró: registeredById queda vacío.
-- Solo pedidos PAID con medio de pago (sin medio no se puede registrar la venta).
INSERT INTO `sales` (
    `restaurantId`, `channel`, `tableId`, `tableNumber`, `takeawayOrderId`,
    `paymentMethod`, `amount`, `total`, `notes`, `imageUrl`, `registeredById`, `closedAt`
)
SELECT
    t.`restaurantId`, 'TAKEAWAY', NULL, NULL, t.`id`,
    t.`paymentMethod`,
    COALESCE(t.`amountPaid`, t.`total`, it.`itemsTotal`),
    COALESCE(t.`total`, it.`itemsTotal`),
    t.`notes`, NULL, NULL,
    COALESCE(t.`paidAt`, t.`updatedAt`)
FROM `takeaway_orders` t
LEFT JOIN (
    SELECT `orderId`, ROUND(SUM(`price` * `quantity`), 2) AS `itemsTotal`
    FROM `takeaway_items`
    GROUP BY `orderId`
) it ON it.`orderId` = t.`id`
WHERE t.`status` = 'PAID'
  AND t.`paymentMethod` IS NOT NULL
  AND COALESCE(t.`total`, it.`itemsTotal`) IS NOT NULL;

-- Ítems de esas ventas (snapshot igual al de las ventas de salón)
INSERT INTO `sale_items` (`saleId`, `menuItemId`, `itemName`, `category`, `quantity`, `price`, `subtotal`)
SELECT
    s.`id`, ti.`menuItemId`, ti.`itemName`, COALESCE(m.`category`, 'unknown'),
    ti.`quantity`, ti.`price`, ROUND(ti.`price` * ti.`quantity`, 2)
FROM `sales` s
JOIN `takeaway_items` ti ON ti.`orderId` = s.`takeawayOrderId`
LEFT JOIN `menu_items` m ON m.`id` = ti.`menuItemId`
WHERE s.`channel` = 'TAKEAWAY';
