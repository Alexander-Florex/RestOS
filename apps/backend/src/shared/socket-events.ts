// ──────────────────────────────────────────────
// socket-events.ts — Nombres de los eventos de socket.
//
// ÚNICA fuente de verdad: el backend lo importa directo y el frontend por el
// alias `@shared/socket-events` (vite.config.ts y tsconfig.app.json).
// Sin imports ni dependencias: tiene que compilar en los dos lados.
// ──────────────────────────────────────────────
export const SocketEvents = {
  // Mesas
  TABLE_CHANGED:           'table:changed',
  TABLE_CREATED:           'table:created',
  TABLE_DELETED:           'table:deleted',
  // Cambió cómo se muestran las mesas (por nombre o por número)
  TABLES_SETTINGS_CHANGED: 'tables-settings:changed',
  // Menú
  MENU_ITEM_CHANGED:       'menu-item:changed',
  MENU_ITEM_CREATED:       'menu-item:created',
  MENU_ITEM_DELETED:       'menu-item:deleted',
  MENU_CATEGORY_CHANGED:   'menu-category:changed',
  MENU_CATEGORY_CREATED:   'menu-category:created',
  MENU_CATEGORY_DELETED:   'menu-category:deleted',
  // Pedidos
  ORDER_CREATED:           'order:created',
  ORDER_DELETED:           'order:deleted',
  // Un pedido abierto cambió (plato anulado, reemplazado o rehecho) — tarea 5.8
  ORDER_UPDATED:           'order:updated',
  // Pedidos de cambio de plato: el mozo pide, caja aprueba o rechaza
  ORDER_CHANGE_REQUESTED:  'order-change:requested',
  ORDER_CHANGE_RESOLVED:   'order-change:resolved',
  // Ventas
  SALE_REGISTERED:         'sale:registered',
  // Inventario
  INVENTORY_ITEM_CHANGED:  'inventory-item:changed',
  INVENTORY_ITEM_CREATED:  'inventory-item:created',
  INVENTORY_ITEM_DELETED:  'inventory-item:deleted',
  // Sectores de guardado (tarea 3.1): se renombraron, agregaron o borraron
  STORAGE_AREAS_CHANGED:   'storage-areas:changed',
  // Toma de inventario (tarea 3.3): se cargó un número, se cerró o se descartó
  STOCK_COUNT_CHANGED:     'stock-count:changed',
  // Staff
  STAFF_CHANGED:           'staff:changed',
  STAFF_CREATED:           'staff:created',
  STAFF_DELETED:           'staff:deleted',
  // Horarios: alguien marcó entrada/salida o se corrigió un turno
  STAFF_SHIFTS_CHANGED:    'staff-shifts:changed',
  // Usuarios (cuentas de login)
  USER_CHANGED:            'user:changed',
  USER_CREATED:            'user:created',
  USER_DELETED:            'user:deleted',
  // Secciones
  SECTION_CHANGED:         'section:changed',
  SECTION_CREATED:         'section:created',
  SECTION_DELETED:         'section:deleted',
  // Reservas
  RESERVATION_CHANGED:     'reservation:changed',
  RESERVATION_CREATED:     'reservation:created',
  RESERVATION_DELETED:     'reservation:deleted',
  // Para llevar
  TAKEAWAY_CREATED:        'takeaway:created',
  TAKEAWAY_UPDATED:        'takeaway:updated',
  TAKEAWAY_DELETED:        'takeaway:deleted',
  // Impresión (lo escucha el agente local, no el navegador)
  PRINT_REQUEST:           'print:request',
} as const;

export type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents];
