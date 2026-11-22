-- Permiso nuevo "Ver pedido de la mesa": lo reciben quienes ya toman pedidos, para que nadie pierda acceso
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'orders.table')
WHERE `key` = 'WAITER' AND NOT JSON_CONTAINS(`permissions`, '"orders.table"');

UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'orders.table')
WHERE `key` = 'CASHIER' AND NOT JSON_CONTAINS(`permissions`, '"orders.table"');

UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'orders.table')
WHERE `key` IS NULL AND JSON_CONTAINS(`permissions`, '"orders.create"') AND NOT JSON_CONTAINS(`permissions`, '"orders.table"');

-- Pedido del cliente: la Caja no ve lo facturado (Inicio, Ventas, Reportes, Analisis y Panel del dueno).
-- Solo cambia el rol Cajero; el Administrador puede devolverle estos permisos desde Roles.
UPDATE `roles` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'sales.view')))
WHERE `key` = 'CASHIER' AND JSON_CONTAINS(`permissions`, '"sales.view"');

UPDATE `roles` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'reports.view')))
WHERE `key` = 'CASHIER' AND JSON_CONTAINS(`permissions`, '"reports.view"');
