// ──────────────────────────────────────────────
// api.ts — Cliente HTTP con auto-token y tipos
// ──────────────────────────────────────────────
import type { Permission } from './permissions';

// Base de URL: si está vacía, usa el proxy de Vite (recomendado en dev)
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const TOKEN_KEY = 'restos_token';

/** Día calendario elegido en pantalla, como "YYYY-MM-DD" (sin hora ni zona). */
function dayParam(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};
const RESTAURANT_ID_KEY = 'restos_restaurant_id';
export const restaurantIdStorage = {
  get: (): number | null => {
    const v = localStorage.getItem(RESTAURANT_ID_KEY);
    return v ? Number(v) : null;
  },
  set: (id: number) => localStorage.setItem(RESTAURANT_ID_KEY, String(id)),
  clear: () => localStorage.removeItem(RESTAURANT_ID_KEY),
};

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

/** Evento de ventana que avisa que el servidor rechazó la sesión (vencida, usuario desactivado...). */
export const SESSION_EXPIRED_EVENT = 'restos:session-expired';

/** Si una llamada con token recibe 401, la sesión ya no sirve: se avisa para volver al login. */
function checkSession(res: Response, sentToken: boolean) {
  if (res.status === 401 && sentToken) {
    tokenStorage.clear();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

function authHeader(): Record<string, string> {
  const token = tokenStorage.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorFrom(res: Response): Promise<ApiError> {
  let data: { error?: string; details?: unknown } | null = null;
  try { data = await res.json(); } catch { /* sin cuerpo JSON */ }
  return new ApiError(res.status, data?.error || `Error HTTP ${res.status}`, data?.details);
}

/** Descarga un archivo protegido (CSV, comprobante) con el token en el header, nunca en la URL. */
async function requestBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const headers = authHeader();
  const res = await fetch(`${BASE}/api${path}`, { headers });
  checkSession(res, 'Authorization' in headers);
  if (!res.ok) throw await errorFrom(res);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await res.blob(), filename };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuth, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
    ...(skipAuth ? {} : authHeader()),
  };

  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  checkSession(res, 'Authorization' in finalHeaders);
  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }

  if (!res.ok) {
    const errData = data as { error?: string; details?: unknown } | null;
    throw new ApiError(
      res.status,
      errData?.error || `Error HTTP ${res.status}`,
      errData?.details
    );
  }

  return data as T;
}

// ──────────────────────────────────────────────
// Tipos compartidos (espejados del backend)
// ──────────────────────────────────────────────
/** Columna legada del backend. Para decidir qué puede hacer alguien, usar `permissions`. */
export type UserRole = 'ADMIN' | 'WAITER' | 'STAFF';

export interface AuthUser {
  restaurantId: number;
  id: number;
  username: string;
  email: string;
  name: string;
  roleId: number;
  roleName: string;
  permissions: Permission[];
  active: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  token: string;
}

// ──────────────────────────────────────────────
// API por módulo
// ──────────────────────────────────────────────
export const authApi = {
  login: (restaurantId: number, username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { restaurantId, username, password },
      skipAuth: true,
    }),

  me: () => request<{ user: AuthUser }>('/auth/me'),

  /** Token nuevo para la sesión actual (el token dura poco; la app lo renueva sola). */
  refresh: () => request<LoginResponse>('/auth/refresh', { method: 'POST' }),
};

export const healthApi = {
  check: () => request<{ status: string; db: string; uptimeSec?: number }>('/health', { skipAuth: true }),
};

// ──────────────────────────────────────────────
// Tablas — tipos y API
// ──────────────────────────────────────────────
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'BILL_REQUESTED' | 'RESERVED';

// ──────────────────────────────────────────────
// Secciones — tipos y API
// ──────────────────────────────────────────────
export interface Section {
  id: number;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export const sectionsApi = {
  list: () => request<{ sections: Section[] }>('/sections'),
  create: (data: { name: string; color?: string }) =>
    request<{ section: Section }>('/sections', { method: 'POST', body: data }),
  update: (id: number, data: { name?: string; color?: string; order?: number }) =>
    request<{ section: Section }>(`/sections/${id}`, { method: 'PATCH', body: data }),
  remove: (id: number) =>
    request<void>(`/sections/${id}`, { method: 'DELETE' }),
};

export interface Table {
  id: number;
  number: number;
  /** Nombre con el que el local llama a la mesa ("Ventana"); null si no tiene */
  name: string | null;
  status: TableStatus;
  capacity: number;
  enabled: boolean;
  guestCount: number | null;
  openedAt: string | null;
  sectionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export const tablesApi = {
  list:    () => request<{ tables: Table[]; labelMode: 'NAME' | 'NUMBER' }>('/tables'),

  /** Mesas por nombre o por número en todas las pantallas (Administrador) */
  setLabelMode: (mode: 'NAME' | 'NUMBER') =>
    request<{ labelMode: 'NAME' | 'NUMBER' }>('/tables/label-mode', { method: 'PUT', body: { mode } }),
  getById: (id: number) => request<{ table: Table }>(`/tables/${id}`),

  create: (data: { number: number; name?: string | null; capacity?: number; sectionId?: number | null }) =>
    request<{ table: Table }>('/tables', { method: 'POST', body: data }),

  update: (id: number, data: { number?: number; name?: string | null; capacity?: number; sectionId?: number | null; enabled?: boolean }) =>
    request<{ table: Table }>(`/tables/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/tables/${id}`, { method: 'DELETE' }),

  toggleEnabled: (id: number) =>
    request<{ table: Table }>(`/tables/${id}/toggle`, { method: 'POST' }),

  open: (id: number, guestCount: number) =>
    request<{ table: Table }>(`/tables/${id}/open`, { method: 'POST', body: { guestCount } }),

  requestBill: (id: number) =>
    request<{ table: Table }>(`/tables/${id}/request-bill`, { method: 'POST' }),

  close: (id: number) =>
    request<{ table: Table }>(`/tables/${id}/close`, { method: 'POST' }),

  reserve: (id: number) =>
    request<{ table: Table }>(`/tables/${id}/reserve`, { method: 'POST' }),

  cancelReservation: (id: number) =>
    request<{ table: Table }>(`/tables/${id}/cancel-reservation`, { method: 'POST' }),
};

// ──────────────────────────────────────────────
// Menú — tipos y API
// ──────────────────────────────────────────────
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: string; // Prisma Decimal viene como string
  description: string | null;
  stock: StockStatus;
  enabled: boolean;
  imageUrl: string | null;
  /** Opciones para personalizar el plato al pedir (las carga el Administrador). */
  optionGroups?: MenuOptionGroup[];
  createdAt: string;
  updatedAt: string;
}

// ── Personalización de platos (tarea 5.7) ──
/** REMOVE: ingredientes para sacar · SINGLE: elegir uno (ej. término) · MULTI: agregados con recargo */
export type MenuOptionGroupType = 'REMOVE' | 'SINGLE' | 'MULTI';

export interface MenuItemOption {
  id: number;
  name: string;
  priceDelta: string; // Decimal como string
  isDefault: boolean;
  sortOrder: number;
}

export interface MenuOptionGroup {
  id: number;
  name: string;
  type: MenuOptionGroupType;
  required: boolean;
  sortOrder: number;
  options: MenuItemOption[];
}

/** Copia de lo elegido que queda guardada en el pedido y en la venta. */
export interface ItemModifier {
  groupId: number;
  group: string;
  kind: MenuOptionGroupType;
  optionId: number;
  option: string;
  priceDelta: string;
}

/** Configuración que guarda el Administrador (ids presentes = se conservan). */
export interface SaveOptionGroupBody {
  id?: number;
  name: string;
  type: MenuOptionGroupType;
  required: boolean;
  options: Array<{ id?: number; name: string; priceDelta: number; isDefault: boolean }>;
}

export interface CreateMenuItemBody {
  name: string;
  category: string;
  price: number;
  description?: string | null;
  stock?: StockStatus;
  enabled?: boolean;
}

export const menuApi = {
  list: (opts?: { category?: string; onlyEnabled?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set('category', opts.category);
    if (opts?.onlyEnabled) params.set('onlyEnabled', 'true');
    const qs = params.toString();
    return request<{ items: MenuItem[] }>(`/menu${qs ? `?${qs}` : ''}`);
  },

  create: (data: CreateMenuItemBody) =>
    request<{ item: MenuItem }>('/menu', { method: 'POST', body: data }),

  update: (id: number, data: Partial<CreateMenuItemBody>) =>
    request<{ item: MenuItem }>(`/menu/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/menu/${id}`, { method: 'DELETE' }),

  toggle: (id: number) =>
    request<{ item: MenuItem }>(`/menu/${id}/toggle`, { method: 'POST' }),

  setStock: (id: number, stock: StockStatus) =>
    request<{ item: MenuItem }>(`/menu/${id}/stock`, { method: 'PATCH', body: { stock } }),

  /** Reemplaza las opciones del plato (solo Administrador / permiso menu.manage). */
  saveOptions: (id: number, groups: SaveOptionGroupBody[]) =>
    request<{ item: MenuItem }>(`/menu/${id}/options`, { method: 'PUT', body: { groups } }),
};

// ──────────────────────────────────────────────
// Categorías del menú — tipos y API
// ──────────────────────────────────────────────
export interface MenuCategory {
  id: number;
  name: string;
  color: string;
  order: number;
  /** Margen objetivo sobre el precio sin IVA (0–0,95) */
  targetMargin: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMenuCategoryBody {
  name: string;
  color?: string;
  order?: number;
  targetMargin?: number | null;
}

export const menuCategoriesApi = {
  list: () => request<{ categories: MenuCategory[] }>('/menu-categories'),

  create: (data: CreateMenuCategoryBody) =>
    request<{ category: MenuCategory }>('/menu-categories', { method: 'POST', body: data }),

  update: (id: number, data: Partial<CreateMenuCategoryBody>) =>
    request<{ category: MenuCategory }>(`/menu-categories/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/menu-categories/${id}`, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────
// Pedidos — tipos y API
// ──────────────────────────────────────────────
export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number | null;
  itemName: string;
  quantity: number;
  /** Precio unitario final (plato + recargos) */
  price: string;
  notes: string | null;
  modifiers?: ItemModifier[] | null;
  /** ACTIVE: se cobra · VOIDED: anulado por un cambio de plato (no se cobra) */
  status?: 'ACTIVE' | 'VOIDED';
  voidReason?: string | null;
}

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export interface Order {
  id: number;
  tableId: number;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
  /** OPEN: en la cuenta · PAID: cobrado · CANCELLED: anulado */
  status?: OrderStatus;
  saleId?: number | null;
  closedAt?: string | null;
  cancelReason?: string | null;
  items: OrderItem[];
}

export interface CreateOrderBody {
  tableId: number;
  guestCount?: number;
  notes?: string | null;
  /** optionIds: opciones elegidas (en grupos "sacar", las que se sacan). El precio lo calcula el servidor. */
  items: Array<{ menuItemId: number; quantity: number; notes?: string; optionIds?: number[] }>;
  /** Id del dispositivo para no duplicar pedidos reintentados (lo pone order-queue.ts) */
  clientRequestId?: string;
}

export const ordersApi = {
  listByTable: (tableId: number) =>
    request<{ orders: Order[]; total: number }>(`/orders/table/${tableId}`),

  create: (data: CreateOrderBody) =>
    request<{ order: Order }>('/orders', { method: 'POST', body: data }),

  // ── Cambios de platos (tarea 5.8) ──
  /** Rehacer: se cobra una sola vez; lo tirado queda como pérdida. */
  remakeItem: (itemId: number, body: { quantity: number; reason: string; fault?: ItemChangeFault | null }) =>
    request<{ change: ItemChange }>(`/orders/items/${itemId}/remake`, { method: 'POST', body }),
  /** Cambiar por otro plato. Con permiso de autorizar se aplica; si no, queda pendiente para caja. */
  replaceItem: (itemId: number, body: {
    quantity: number; reason: string; fault?: ItemChangeFault | null; wasPrepared: boolean;
    replacement: { menuItemId: number; optionIds?: number[]; notes?: string | null };
  }) => request<{ change: ItemChange }>(`/orders/items/${itemId}/replace`, { method: 'POST', body }),
  listChanges: (filters: { status?: ItemChangeStatus; from?: Date; to?: Date; tableId?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.from) params.set('from', dayParam(filters.from));
    if (filters.to) params.set('to', dayParam(filters.to));
    if (filters.tableId) params.set('tableId', String(filters.tableId));
    const qs = params.toString();
    return request<{ changes: ItemChange[] }>(`/orders/changes${qs ? `?${qs}` : ''}`);
  },
  approveChange: (id: number) => request<{ change: ItemChange }>(`/orders/changes/${id}/approve`, { method: 'POST' }),
  rejectChange: (id: number, reason?: string) =>
    request<{ change: ItemChange }>(`/orders/changes/${id}/reject`, { method: 'POST', body: { reason: reason || null } }),

  /** Anula un pedido abierto con motivo (no se borra: queda en el historial). */
  cancel: (id: number, reason: string) =>
    request<{ order: Order }>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
};

// ──────────────────────────────────────────────
// Ventas — tipos y API
// ──────────────────────────────────────────────
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';
/** Salón (mesa) o para llevar */
export type SaleChannel = 'DINE_IN' | 'TAKEAWAY';

export interface Sale {
  id: number;
  channel: SaleChannel;
  tableId: number | null;
  /** null en ventas para llevar */
  tableNumber: number | null;
  /** Nombre de la mesa al cobrar (mesas unidas: "Ventana + Patio") */
  tableName?: string | null;
  takeawayOrderId: number | null;
  paymentMethod: PaymentMethod;
  amount: string;
  total: string;
  notes: string | null;
  imageUrl: string | null;
  registeredById: number | null;
  closedAt: string;
  createdAt: string;
}

export interface CreateSaleBody {
  tableId: number;
  paymentMethod: PaymentMethod;
  amount: number;
  notes?: string;
  imageBase64?: string;
}

export interface DailyStats {
  total: number;
  count: number;
  byMethod: Record<PaymentMethod, { count: number; amount: number }>;
}

export const salesApi = {
  list: (filters?: { from?: Date; to?: Date; paymentMethod?: PaymentMethod }) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from.toISOString());
    if (filters?.to) params.set('to', filters.to.toISOString());
    if (filters?.paymentMethod) params.set('paymentMethod', filters.paymentMethod);
    const qs = params.toString();
    return request<{ sales: Sale[] }>(`/sales${qs ? `?${qs}` : ''}`);
  },

  create: (data: CreateSaleBody) =>
    request<{ sale: Sale }>('/sales', { method: 'POST', body: data }),

  /**
   * Imagen del comprobante de una venta como URL local (blob:). Es privada, así
   * que no se puede usar la ruta directa en <img>. Liberarla con URL.revokeObjectURL.
   */
  receiptImageUrl: async (saleId: number): Promise<string> => {
    const { blob } = await requestBlob(`/sales/${saleId}/receipt`);
    return URL.createObjectURL(blob);
  },

  /** Sin fecha: el día de hoy según la hora del restaurante. */
  dailyStats: (date?: Date) => {
    const params = new URLSearchParams();
    if (date) params.set('date', dayParam(date));
    const qs = params.toString();
    return request<DailyStats>(`/sales/stats/daily${qs ? `?${qs}` : ''}`);
  },
};

// ──────────────────────────────────────────────
// Inventario — tipos y API
// ──────────────────────────────────────────────
export type InventoryCategory = 'FOOD' | 'BEVERAGE' | 'SUPPLIES' | 'EQUIPMENT';

export interface InventoryItem {
  id: number;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minStock: number;
  costPerUnit: string; // Prisma Decimal viene como string
  /** "1 <unit> = equivalenceQty <equivalenceUnit>" (otra familia de unidad), ej. 1 un = 60 g */
  equivalenceQty: number | null;
  equivalenceUnit: string | null;
  /** Presentación de compra (ej. 25 kg a $25.000): si está, el costo se calcula */
  purchaseQty: number | null;
  purchaseUnit: string | null;
  purchasePrice: string | null;
  /** Merma por defecto en recetas (0–0,95) */
  wastePct: number;
  /** Sector de guardado (tarea 3.1) y orden dentro del sector para el conteo */
  storageAreaId: number | null;
  countOrder: number;
  supplier: string | null;
  lastRestocked: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInventoryBody {
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minStock?: number;
  costPerUnit?: number;
  supplier?: string | null;
  equivalenceQty?: number | null;
  equivalenceUnit?: string | null;
  purchaseQty?: number | null;
  purchaseUnit?: string | null;
  purchasePrice?: number | null;
  wastePct?: number;
  storageAreaId?: number | null;
  countOrder?: number;
}

/** La cantidad no se edita: va por reponer, consumir, ajustar o un conteo. */
export type UpdateInventoryBody = Partial<Omit<CreateInventoryBody, 'quantity'>>;

export type StockMovementType = 'PURCHASE' | 'SALE' | 'PRODUCTION' | 'CONSUMPTION' | 'WASTE' | 'ADJUSTMENT' | 'COUNT';

export interface StockMovement {
  id: number;
  inventoryItemId: number;
  type: StockMovementType;
  /** Con signo, en la unidad del insumo */
  quantity: number;
  balanceAfter: number;
  unitCost: string | null;
  reason: string | null;
  reference: string | null;
  stockCountId: number | null;
  userName: string | null;
  createdAt: string;
}

export interface PriceHistoryEntry {
  id: number;
  costPerUnit: string;
  previousCost: string | null;
  unit: string;
  purchaseQty: number | null;
  purchaseUnit: string | null;
  purchasePrice: string | null;
  source: 'MANUAL' | 'PURCHASE' | 'IMPORT';
  userName: string | null;
  createdAt: string;
}

export const inventoryApi = {
  list: (opts?: { category?: InventoryCategory; search?: string }) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set('category', opts.category);
    if (opts?.search) params.set('search', opts.search);
    const qs = params.toString();
    return request<{ items: InventoryItem[] }>(`/inventory${qs ? `?${qs}` : ''}`);
  },

  create: (data: CreateInventoryBody) =>
    request<{ item: InventoryItem }>('/inventory', { method: 'POST', body: data }),

  update: (id: number, data: UpdateInventoryBody) =>
    request<{ item: InventoryItem }>(`/inventory/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/inventory/${id}`, { method: 'DELETE' }),

  priceHistory: (id: number) => request<{ history: PriceHistoryEntry[] }>(`/inventory/${id}/price-history`),

  /** En la unidad del insumo ({amount}) o en presentaciones, con precio nuevo opcional. */
  restockWith: (id: number, body: { amount?: number; presentations?: number; purchasePrice?: number }) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/restock`, { method: 'POST', body }),

  restock: (id: number, amount: number) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/restock`, { method: 'POST', body: { amount } }),

  consume: (id: number, amount: number, reason?: string) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/consume`, { method: 'POST', body: { amount, reason } }),

  /** Fija la cantidad real con un motivo (queda como movimiento de ajuste). */
  adjust: (id: number, quantity: number, reason: string) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/adjust`, { method: 'POST', body: { quantity, reason } }),

  movements: (id: number) =>
    request<{ movements: StockMovement[] }>(`/inventory/${id}/movements`),
};

// ──────────────────────────────────────────────
// Sectores de guardado (tarea 3.1)
// ──────────────────────────────────────────────
export interface StorageArea {
  id: number;
  name: string;
  sortOrder: number;
  itemCount: number;
}

export const storageAreasApi = {
  list: () => request<{ areas: StorageArea[] }>('/storage-areas'),
  create: (data: { name: string; sortOrder?: number }) =>
    request<{ area: StorageArea }>('/storage-areas', { method: 'POST', body: data }),
  update: (id: number, data: { name?: string; sortOrder?: number }) =>
    request<{ area: StorageArea }>(`/storage-areas/${id}`, { method: 'PATCH', body: data }),
  remove: (id: number) => request<void>(`/storage-areas/${id}`, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────
// Toma de inventario (tarea 3.3)
// ──────────────────────────────────────────────
export type StockCountStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface StockCountSummaryRow {
  id: number;
  storageAreaId: number | null;
  areaName: string;
  status: StockCountStatus;
  notes: string | null;
  startedByName: string | null;
  closedByName: string | null;
  startedAt: string;
  closedAt: string | null;
  totalLines: number;
  countedLines: number;
  differences: number;
  differenceValue: number;
}

export interface StockCountLine {
  id: number;
  inventoryItemId: number | null;
  itemName: string;
  unit: string;
  position: number;
  /** null = sin contar */
  countedQty: number | null;
  countedAt: string | null;
  countedByName: string | null;
  /** Solo en conteos cerrados (mientras está abierto se cuenta a ciegas) */
  expectedQty: number | null;
  difference: number | null;
  unitCost: string | null;
  reason: string | null;
  /** Sector actual del insumo (para agrupar el conteo de todo el stock) */
  areaName: string | null;
}

export interface StockCount {
  id: number;
  storageAreaId: number | null;
  areaName: string;
  status: StockCountStatus;
  notes: string | null;
  startedByName: string | null;
  closedByName: string | null;
  startedAt: string;
  closedAt: string | null;
  lines: StockCountLine[];
}

export interface StockCountPreview {
  totalLines: number;
  countedLines: number;
  uncounted: number;
  differenceValue: number;
  differences: {
    lineId: number;
    itemName: string;
    unit: string;
    countedQty: number;
    expectedQty: number;
    difference: number;
    value: number;
    reason: string | null;
  }[];
}

export const stockCountsApi = {
  list: () => request<{ counts: StockCountSummaryRow[] }>('/stock-counts'),
  get: (id: number) => request<{ count: StockCount }>(`/stock-counts/${id}`),
  /** storageAreaId null = todo el stock */
  create: (storageAreaId: number | null, notes?: string) =>
    request<{ count: StockCount }>('/stock-counts', { method: 'POST', body: { storageAreaId, notes } }),
  setLine: (id: number, lineId: number, data: { countedQty?: number | null; reason?: string | null }) =>
    request<{ line: StockCountLine }>(`/stock-counts/${id}/lines/${lineId}`, { method: 'PUT', body: data }),
  summary: (id: number) => request<{ summary: StockCountPreview }>(`/stock-counts/${id}/summary`),
  close: (id: number, notes?: string) =>
    request<{ count: StockCount; summary: { differences: number; differenceValue: number; countedLines: number } }>(
      `/stock-counts/${id}/close`, { method: 'POST', body: { notes } }),
  cancel: (id: number, reason?: string) =>
    request<{ count: StockCount }>(`/stock-counts/${id}/cancel`, { method: 'POST', body: { reason } }),
};

// ──────────────────────────────────────────────
// Recetas y costos — tipos y API
// ──────────────────────────────────────────────
export interface RecipeIngredient {
  id: number;
  recipeId: number;
  /** Un insumo o una sub-receta (uno de los dos) */
  inventoryItemId: number | null;
  subRecipeId: number | null;
  quantity: number;
  unit: string;
  /** Merma de la línea; null = la del insumo */
  wastePct: number | null;
  inventoryItem: InventoryItem | null;
  subRecipe: { id: number; name: string } | null;
}

export interface RecipeCostLine {
  ingredientId: number;
  kind: 'item' | 'subrecipe';
  inventoryItemId: number | null;
  subRecipeId: number | null;
  name: string;
  quantity: number;
  unit: string;
  wastePct: number;
  /** Cantidad bruta (con merma) */
  grossQty: number;
  /** Cantidad en la unidad del insumo (null si no se pudo convertir) */
  convertedQty: number | null;
  itemUnit: string;
  cost: number | null;
  error: string | null;
}

export interface RecipeCost {
  /** Suma de las líneas que se pudieron calcular */
  costTotal: number;
  lines: RecipeCostLine[];
  /** Líneas con unidad inconvertible: el costo está incompleto */
  warnings: string[];
  complete: boolean;
  costPerServing: number;
  /** Costo por unidad de rendimiento (si la receta rinde en unidades) */
  costPerYieldUnit: number | null;
  /** Margen objetivo (sobre el precio sin IVA) */
  margin: number;
  /** Costo de mercadería objetivo = 1 − margen */
  foodCostPct: number;
  /** Precio sugerido sin IVA = costo / (1 − margen) */
  suggestedPriceNet: number | null;
  /** Precio sugerido con IVA */
  suggestedPrice: number | null;
  /** Precio de la carta (con IVA) */
  menuItemPrice: number | null;
  /** Margen real con el precio de la carta */
  actualMargin: number | null;
  actualFoodCostPct: number | null;
  belowTarget: boolean;
  priceDiff: number | null;
}

export interface MenuItemCost {
  menuItemId: number;
  recipeId: number;
  recipeName: string;
  costPerServing: number;
  complete: boolean;
  margin: number;
  actualMargin: number | null;
  actualFoodCostPct: number | null;
  belowTarget: boolean;
  suggestedPrice: number | null;
}

export interface CostAlert {
  inventoryItemId: number;
  itemName: string;
  unit: string;
  previousCost: number;
  currentCost: number;
  changePct: number;
  changedAt: string;
  dishes: Array<{
    menuItemId: number; menuItemName: string; recipeId: number; recipeName: string;
    menuItemPrice: number | null; costBefore: number; costNow: number;
    previousMargin: number | null; currentMargin: number | null; targetMargin: number;
    belowTarget: boolean; suggestedPrice: number | null;
  }>;
  otherRecipes: string[];
}

export interface Recipe {
  id: number;
  menuItemId: number | null;
  menuItem: MenuItem | null;
  name: string;
  yield: number;
  /** Rendimiento en unidades (ej. 500 cc), para usarla como sub-receta */
  yieldQty: number | null;
  yieldUnit: string | null;
  profitPct: number;
  vatPct: number;
  notes: string | null;
  ingredients: RecipeIngredient[];
  cost: RecipeCost;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredientBody {
  inventoryItemId?: number | null;
  subRecipeId?: number | null;
  quantity: number;
  /** Unidad, o "porcion" para una sub-receta usada por porciones */
  unit: string;
  wastePct?: number | null;
}

export interface CreateRecipeBody {
  name: string;
  menuItemId?: number | null;
  yield?: number;
  yieldQty?: number | null;
  yieldUnit?: string | null;
  profitPct?: number;
  vatPct?: number;
  notes?: string | null;
  ingredients: RecipeIngredientBody[];
}

export const recipesApi = {
  list: () => request<{ recipes: Recipe[] }>('/recipes'),

  getById: (id: number) => request<{ recipe: Recipe }>(`/recipes/${id}`),

  create: (data: CreateRecipeBody) =>
    request<{ recipe: Recipe }>('/recipes', { method: 'POST', body: data }),

  update: (id: number, data: Partial<CreateRecipeBody>) =>
    request<{ recipe: Recipe }>(`/recipes/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/recipes/${id}`, { method: 'DELETE' }),

  /** Costo y margen de cada plato de la carta con receta (tarea 2.7) */
  menuCosts: () => request<{ items: MenuItemCost[] }>('/recipes/menu-costs'),

  /** Insumos que subieron y platos afectados (tarea 2.8) */
  costAlerts: (days = 30) => request<{ alerts: CostAlert[] }>(`/recipes/cost-alerts?days=${days}`),
};

// ──────────────────────────────────────────────
// Staff — tipos y API
// ──────────────────────────────────────────────
export type StaffRole = 'WAITER' | 'CHEF' | 'MANAGER' | 'CASHIER';

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  phone: string | null;
  active: boolean;
  cuit: string | null;
  /** Valor por hora (Decimal como texto); null = sin cargar */
  hourlyRate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffBody {
  name: string;
  email: string;
  role: StaffRole;
  phone?: string | null;
  active?: boolean;
  cuit?: string | null;
  hourlyRate?: number | null;
}

// ── Horarios del personal ──
export interface StaffWeekShift {
  id: number;
  /** Día (hora del local) en que empezó el turno */
  day: string;
  clockIn: string;
  clockOut: string | null;
  minutes: number;
  amount: number;
  hourlyRate: number | null;
  note: string | null;
}
export interface StaffWeekRow {
  id: number;
  name: string;
  role: StaffRole;
  active: boolean;
  hourlyRate: number | null;
  openShift: { id: number; clockIn: string } | null;
  minutes: number;
  amount: number;
  missingRate: boolean;
  shifts: StaffWeekShift[];
}
export interface StaffWeek {
  weekStart: string;
  weekEnd: string;
  staff: StaffWeekRow[];
  totals: { minutes: number; amount: number };
}
export interface ShiftBody {
  /** Día de la entrada (YYYY-MM-DD) */
  day: string;
  /** HH:MM; una salida más temprano que la entrada es del día siguiente */
  from: string;
  to: string | null;
  note?: string | null;
  reason: string;
}

export const staffShiftsApi = {
  week: (day?: string) => request<StaffWeek>(`/staff-shifts/week${day ? `?day=${day}` : ''}`),
  clockIn: (staffId: number) => request<unknown>(`/staff-shifts/staff/${staffId}/clock-in`, { method: 'POST' }),
  clockOut: (staffId: number) => request<unknown>(`/staff-shifts/staff/${staffId}/clock-out`, { method: 'POST' }),
  create: (data: ShiftBody & { staffMemberId: number }) => request<unknown>('/staff-shifts', { method: 'POST', body: data }),
  update: (id: number, data: ShiftBody) => request<unknown>(`/staff-shifts/${id}`, { method: 'PATCH', body: data }),
  remove: (id: number, reason: string) => request<void>(`/staff-shifts/${id}`, { method: 'DELETE', body: { reason } }),
  downloadCsv: async (day: string): Promise<void> => {
    const { blob, filename } = await requestBlob(`/staff-shifts/week.csv?day=${day}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `horarios-${day}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

// ── ARCA ──
export interface ArcaImpuesto {
  idImpuesto: number;
  descripcionImpuesto: string;
  periodoDesde?: string;
}
export interface ArcaCategoria {
  idCategoria: number;
  descripcionCategoria: string;
  periodo?: string;
}
export interface ArcaActividad {
  idActividad: number;
  descripcionActividad: string;
}
export interface ArcaPadronData {
  cuit: string;
  nombre: string;
  tipoPersona: string;
  estadoClave: string; // 'ACTIVO' | 'INACTIVO' | 'NO_ENCONTRADO' | 'ERROR_CONSULTA'
  impuestos: ArcaImpuesto[];
  categorias: ArcaCategoria[];
  actividades: ArcaActividad[];
  fetchedAt: string;
  error?: string;
}

export const staffApi = {
  list: (opts?: { role?: StaffRole; activeOnly?: boolean }) => {
    const params = new URLSearchParams();
    if (opts?.role) params.set('role', opts.role);
    if (opts?.activeOnly) params.set('activeOnly', 'true');
    const qs = params.toString();
    return request<{ members: StaffMember[] }>(`/staff${qs ? `?${qs}` : ''}`);
  },

  create: (data: CreateStaffBody) =>
    request<{ member: StaffMember }>('/staff', { method: 'POST', body: data }),

  update: (id: number, data: Partial<CreateStaffBody>) =>
    request<{ member: StaffMember }>(`/staff/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/staff/${id}`, { method: 'DELETE' }),

  toggleActive: (id: number) =>
    request<{ member: StaffMember }>(`/staff/${id}/toggle`, { method: 'POST' }),

  queryArca: (id: number) =>
    request<{ arca: ArcaPadronData }>(`/staff/${id}/arca`),

  invalidateArcaCache: (id: number) =>
    request<{ message: string }>(`/staff/${id}/arca-cache`, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────
// Usuarios (cuentas de login) — requiere users.manage
// ──────────────────────────────────────────────
export interface AppUser {
  id: number;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  roleId: number | null;
  roleName: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserBody {
  username: string;
  email: string;
  password: string;
  name: string;
  roleId: number;
  active?: boolean;
}

export interface UpdateUserBody {
  username?: string;
  email?: string;
  password?: string;
  name?: string;
  roleId?: number;
  active?: boolean;
}

// ──────────────────────────────────────────────
// Roles y permisos — requiere users.manage
// ──────────────────────────────────────────────
export interface AppRole {
  id: number;
  name: string;
  /** ADMIN | WAITER | CASHIER para los roles de sistema; null para los que crea el administrador. */
  key: string | null;
  system: boolean;
  locked: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface PermissionInfo {
  key: Permission;
  group: string;
  label: string;
  description: string;
}

export const rolesApi = {
  permissions: () => request<{ permissions: PermissionInfo[] }>('/roles/permissions'),
  list: () => request<{ roles: AppRole[] }>('/roles'),
  create: (data: { name: string; permissions: Permission[] }) =>
    request<{ role: AppRole }>('/roles', { method: 'POST', body: data }),
  update: (id: number, data: { name?: string; permissions?: Permission[] }) =>
    request<{ role: AppRole }>(`/roles/${id}`, { method: 'PATCH', body: data }),
  remove: (id: number) => request<void>(`/roles/${id}`, { method: 'DELETE' }),
};

export const usersApi = {
  list: () => request<{ users: AppUser[] }>('/users'),

  create: (data: CreateUserBody) =>
    request<{ user: AppUser }>('/users', { method: 'POST', body: data }),

  update: (id: number, data: UpdateUserBody) =>
    request<{ user: AppUser }>(`/users/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/users/${id}`, { method: 'DELETE' }),

  toggleActive: (id: number) =>
    request<{ user: AppUser }>(`/users/${id}/toggle`, { method: 'POST' }),
};

// ──────────────────────────────────────────────
// Reservas — tipos y API
// ──────────────────────────────────────────────
export type ReservationStatus =
  | 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Reservation {
  id: number;
  tableId: number | null;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  reservedAt: string;
  duration: number;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReservationBody {
  customerName: string;
  customerPhone?: string | null;
  partySize: number;
  reservedAt: string; // ISO
  duration?: number;
  tableId?: number | null;
  notes?: string | null;
  status?: ReservationStatus;
}

export const reservationsApi = {
  list: (filters?: { from?: Date; to?: Date; status?: ReservationStatus; tableId?: number }) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from.toISOString());
    if (filters?.to)   params.set('to',   filters.to.toISOString());
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tableId) params.set('tableId', String(filters.tableId));
    const qs = params.toString();
    return request<{ reservations: Reservation[] }>(`/reservations${qs ? `?${qs}` : ''}`);
  },

  upcoming: () => request<{ reservations: Reservation[] }>('/reservations/upcoming'),

  create: (data: CreateReservationBody) =>
    request<{ reservation: Reservation }>('/reservations', { method: 'POST', body: data }),

  update: (id: number, data: Partial<CreateReservationBody>) =>
    request<{ reservation: Reservation }>(`/reservations/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/reservations/${id}`, { method: 'DELETE' }),

  cancel: (id: number) =>
    request<{ reservation: Reservation }>(`/reservations/${id}/cancel`, { method: 'POST' }),

  noShow: (id: number) =>
    request<{ reservation: Reservation }>(`/reservations/${id}/no-show`, { method: 'POST' }),

  seat: (id: number) =>
    request<{ reservation: Reservation; tableId: number }>(`/reservations/${id}/seat`, { method: 'POST' }),

  markTableReserved: (id: number) =>
    request<{ reservation: Reservation }>(`/reservations/${id}/mark-table-reserved`, { method: 'POST' }),
};

// ──────────────────────────────────────────────
// Reportes — tipos y API
// ──────────────────────────────────────────────
export interface SalesReport {
  range: { from: string; to: string };
  totals: {
    totalSold: number;
    totalCollected: number;
    salesCount: number;
    averageTicket: number;
  };
  byPaymentMethod: Array<{
    method: PaymentMethod;
    count: number;
    amount: number;
    percentage: number;
  }>;
  byDay: Array<{ date: string; total: number; count: number }>;
  byChannel: Array<{ channel: SaleChannel; count: number; total: number }>;
  /** Solo salón */
  byTable: Array<{ tableNumber: number; tableName: string | null; count: number; total: number }>;
}

export interface TopItem {
  menuItemId: number | null;
  itemName: string;
  category: string;
  quantity: number;
  revenue: number;
}

export interface DailyTicket {
  id: number;
  channel: SaleChannel;
  /** null en ventas para llevar */
  tableNumber: number | null;
  tableName: string | null;
  /** Cliente del pedido para llevar */
  customerName: string | null;
  closedAt: string;
  total: number;
  amount: number;
  paymentMethod: PaymentMethod;
  registeredByName: string | null;
  items: Array<{ itemName: string; quantity: number; subtotal: number }>;
}

// Los reportes trabajan por días completos: se manda el día calendario elegido
// ("YYYY-MM-DD") y el servidor lo interpreta en la hora del restaurante.
export const reportsApi = {
  salesReport: (from: Date, to: Date) => {
    const params = new URLSearchParams({
      from: dayParam(from),
      to: dayParam(to),
    });
    return request<SalesReport>(`/reports/sales?${params}`);
  },

  topItems: (from: Date, to: Date, limit = 10) => {
    const params = new URLSearchParams({
      from: dayParam(from),
      to: dayParam(to),
      limit: String(limit),
    });
    return request<{ items: TopItem[] }>(`/reports/top-items?${params}`);
  },

  dailyTickets: (date: Date) => {
    const params = new URLSearchParams({ date: dayParam(date) });
    return request<{ tickets: DailyTicket[] }>(`/reports/tickets?${params}`);
  },

  /** Descarga el CSV de ventas del rango (con el token en el header, no en la URL). */
  downloadCsv: async (from: Date, to: Date): Promise<void> => {
    const params = new URLSearchParams({ from: dayParam(from), to: dayParam(to) });
    const { blob, filename } = await requestBlob(`/reports/sales.csv?${params}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `ventas-${dayParam(from)}-${dayParam(to)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

// ──────────────────────────────────────────────
// Impresión — tipos y API
// ──────────────────────────────────────────────
// Imprime el agente local (no se elige impresora desde el navegador).
// Los tickets se arman en el backend con los datos guardados.
export const printingApi = {
  // Comanda de cocina de un pedido de mesa
  printOrder: (orderId: number) =>
    request<{ ok: boolean; message: string }>(`/printing/orders/${orderId}`, {
      method: 'POST', body: {},
    }),

  // Comanda de cocina de un pedido para llevar
  printTakeawayOrder: (takeawayId: number) =>
    request<{ ok: boolean; message: string }>(`/printing/takeaway/${takeawayId}`, {
      method: 'POST', body: {},
    }),

  // Ticket de caja de una venta de mesa ya registrada
  printSale: (saleId: number) =>
    request<{ ok: boolean; message: string }>(`/printing/sales/${saleId}`, {
      method: 'POST', body: {},
    }),

  // Ticket de caja de un pedido para llevar ya cobrado
  printTakeawayReceipt: (takeawayId: number) =>
    request<{ ok: boolean; message: string }>(`/printing/takeaway/${takeawayId}/receipt`, {
      method: 'POST', body: {},
    }),
};
// ──────────────────────────────────────────────
// Para llevar — tipos y API
// ──────────────────────────────────────────────
export type TakeawayStatus = 'OPEN' | 'READY' | 'PAID' | 'CANCELLED';

export interface TakeawayItem {
  id:         number;
  orderId:    number;
  menuItemId: number | null;
  itemName:   string;
  quantity:   number;
  price:      number | string;
  notes:      string | null;
  modifiers?: ItemModifier[] | null;
}

export interface TakeawayOrder {
  id:            number;
  customerName:  string;
  customerPhone: string | null;
  status:        TakeawayStatus;
  notes:         string | null;
  paymentMethod: PaymentMethod | null;
  amountPaid:    number | string | null;
  total:         number | string | null;
  paidAt:        string | null;
  createdAt:     string;
  updatedAt:     string;
  items:         TakeawayItem[];
}

export interface CreateTakeawayBody {
  customerName:  string;
  customerPhone?: string | null;
  notes?:         string | null;
  items: Array<{ menuItemId: number; quantity: number; notes?: string | null; optionIds?: number[] }>;
  /** Id del dispositivo para no duplicar pedidos reintentados (lo pone order-queue.ts) */
  clientRequestId?: string;
}

export const takeawayApi = {
  list: (filters?: { status?: TakeawayStatus; date?: Date }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.date)   params.set('date', filters.date.toISOString());
    const qs = params.toString();
    return request<{ orders: TakeawayOrder[] }>(`/takeaway${qs ? `?${qs}` : ''}`);
  },

  getById: (id: number) =>
    request<{ order: TakeawayOrder }>(`/takeaway/${id}`),

  create: (data: CreateTakeawayBody) =>
    request<{ order: TakeawayOrder }>('/takeaway', { method: 'POST', body: data }),

  markReady: (id: number) =>
    request<{ order: TakeawayOrder }>(`/takeaway/${id}/ready`, { method: 'POST' }),

  pay: (id: number, data: { paymentMethod: PaymentMethod; amountPaid: number; notes?: string | null }) =>
    request<{ order: TakeawayOrder; sale: Sale }>(`/takeaway/${id}/pay`, { method: 'POST', body: data }),

  cancel: (id: number) =>
    request<{ order: TakeawayOrder }>(`/takeaway/${id}/cancel`, { method: 'POST' }),

  remove: (id: number) =>
    request<void>(`/takeaway/${id}`, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────
// Auditoría (tarea 1.2) — solo lectura, permiso audit.view
// ──────────────────────────────────────────────
export type AuditAction =
  | 'sale.create' | 'takeaway.pay' | 'takeaway.cancel' | 'order.cancel'
  | 'order.item.remake' | 'order.item.replace' | 'order.item.reject'
  | 'menu.price' | 'menu.options' | 'menu.delete'
  | 'inventory.restock' | 'inventory.consume' | 'inventory.update' | 'inventory.delete'
  | 'inventory.adjust' | 'inventory.count.close' | 'inventory.count.cancel'
  | 'user.create' | 'user.update' | 'user.toggle' | 'user.delete'
  | 'role.create' | 'role.update' | 'role.delete';

export interface AuditEntry {
  id: number;
  userId: number | null;
  /** Nombre en el momento de la acción (queda aunque se borre la cuenta) */
  userName: string | null;
  action: AuditAction | string;
  entity: string;
  entityId: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  entries: AuditEntry[];
}

// ──────────────────────────────────────────────
// Estado del respaldo nocturno (tarea 6.3) — permiso system.backup
// ──────────────────────────────────────────────
export type BackupHealth = 'ok' | 'solo-local' | 'atrasado' | 'falla' | 'nunca' | 'sin-configurar';

export interface BackupStatus {
  health: BackupHealth;
  destinations: ('copia' | 'sftp')[];
  lastCompleteDay: string | null;
  lastLocalAt: string | null;
  lastError: string | null;
  pending: number;
}

export const systemApi = {
  backup: () => request<{ backup: BackupStatus }>('/system/backup'),
};

export const auditApi = {
  /** Sin fechas: últimos 7 días. `action`: acciones o prefijos separados por coma. */
  list: (filters: { from?: Date; to?: Date; action?: string; userId?: number; page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', dayParam(filters.from));
    if (filters.to) params.set('to', dayParam(filters.to));
    if (filters.action) params.set('action', filters.action);
    if (filters.userId) params.set('userId', String(filters.userId));
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    const qs = params.toString();
    return request<AuditPage>(`/audit${qs ? `?${qs}` : ''}`);
  },
  actors: () => request<{ actors: Array<{ userId: number | null; userName: string }> }>('/audit/actors'),
};

// ──────────────────────────────────────────────
// Cambios de platos (tarea 5.8)
// ──────────────────────────────────────────────
export type ItemChangeType = 'REMAKE' | 'REPLACE';
export type ItemChangeStatus = 'PENDING' | 'APPLIED' | 'REJECTED';
/** De quién fue el error */
export type ItemChangeFault = 'KITCHEN' | 'WAITER' | 'CUSTOMER' | 'OTHER';

export interface ItemChange {
  id: number;
  orderId: number;
  orderItemId: number;
  type: ItemChangeType;
  status: ItemChangeStatus;
  quantity: number;
  reason: string;
  fault: ItemChangeFault | null;
  /** Ya estaba hecho: es pérdida */
  wasPrepared: boolean;
  itemSnapshot: { itemName: string; price: string; modifiers: ItemModifier[] | null; notes: string | null };
  replacementMenuItemId: number | null;
  /** Nombre del plato de reemplazo */
  replacementName: string | null;
  replacementNotes: string | null;
  newOrderItemId: number | null;
  rejectReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  order: { id: number; tableId: number; status: OrderStatus; table: { number: number; name: string | null } };
  requestedBy: { id: number; name: string } | null;
  resolvedBy: { id: number; name: string } | null;
}
