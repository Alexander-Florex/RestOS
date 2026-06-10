// ──────────────────────────────────────────────
// api.ts — Cliente HTTP con auto-token y tipos
// ──────────────────────────────────────────────

// Base de URL: si está vacía, usa el proxy de Vite (recomendado en dev)
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const TOKEN_KEY = 'restos_token';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuth, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = tokenStorage.get();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

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
export type UserRole = 'ADMIN' | 'WAITER' | 'STAFF';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  name: string;
  role: UserRole;
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
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
    }),

  me: () => request<{ user: AuthUser }>('/auth/me'),
};

export const healthApi = {
  check: () => request<{ status: string; env: string; db: string }>('/health', { skipAuth: true }),
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
  list:    () => request<{ tables: Table[] }>('/tables'),
  getById: (id: number) => request<{ table: Table }>(`/tables/${id}`),

  create: (data: { number: number; capacity?: number; sectionId?: number | null }) =>
    request<{ table: Table }>('/tables', { method: 'POST', body: data }),

  update: (id: number, data: { number?: number; capacity?: number; sectionId?: number | null; enabled?: boolean }) =>
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
  createdAt: string;
  updatedAt: string;
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
  price: string;
  notes: string | null;
}

export interface Order {
  id: number;
  tableId: number;
  createdById: number | null;
  createdAt: string;
  items: OrderItem[];
}

export interface CreateOrderBody {
  tableId: number;
  guestCount?: number;
  items: Array<{ menuItemId: number; quantity: number; notes?: string }>;
}

export const ordersApi = {
  listByTable: (tableId: number) =>
    request<{ orders: Order[]; total: number }>(`/orders/table/${tableId}`),

  create: (data: CreateOrderBody) =>
    request<{ order: Order }>('/orders', { method: 'POST', body: data }),

  remove: (id: number) =>
    request<void>(`/orders/${id}`, { method: 'DELETE' }),
};

// ──────────────────────────────────────────────
// Ventas — tipos y API
// ──────────────────────────────────────────────
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

export interface Sale {
  id: number;
  tableId: number | null;
  tableNumber: number;
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

  dailyStats: (date?: Date) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date.toISOString());
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
  supplier?: string | null;
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

  update: (id: number, data: Partial<CreateInventoryBody>) =>
    request<{ item: InventoryItem }>(`/inventory/${id}`, { method: 'PATCH', body: data }),

  remove: (id: number) =>
    request<void>(`/inventory/${id}`, { method: 'DELETE' }),

  restock: (id: number, amount: number) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/restock`, { method: 'POST', body: { amount } }),

  consume: (id: number, amount: number) =>
    request<{ item: InventoryItem }>(`/inventory/${id}/consume`, { method: 'POST', body: { amount } }),
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
}

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
}

export interface TopItem {
  menuItemId: number | null;
  itemName: string;
  category: string;
  quantity: number;
  revenue: number;
}

export const reportsApi = {
  salesReport: (from: Date, to: Date) => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return request<SalesReport>(`/reports/sales?${params}`);
  },

  topItems: (from: Date, to: Date, limit = 10) => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      limit: String(limit),
    });
    return request<{ items: TopItem[] }>(`/reports/top-items?${params}`);
  },

  /** URL para descarga directa de CSV con token por query (no requiere fetch + Blob). */
  csvUrl: (from: Date, to: Date): string => {
    const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      token: tokenStorage.get() ?? '',
    });
    return `${base}/api/reports/sales.csv?${params}`;
  },
};

// ──────────────────────────────────────────────
// Impresión — tipos y API
// ──────────────────────────────────────────────
export interface PrinterInfo {
  name: string;
  isDefault?: boolean;
  status?: string;
}

export interface PrintOrderOptions {
  printerName: string;
  restaurantName?: string;
  isKitchenTicket?: boolean;
  paymentMethod?: string;
  amountPaid?: number;
  notes?: string | null;
}

export const printingApi = {
  listPrinters: () =>
    request<{ printers: PrinterInfo[]; platform: string }>('/printing/printers'),

  printOrder: (orderId: number, opts: PrintOrderOptions) =>
    request<{ ok: boolean; message: string }>(`/printing/orders/${orderId}`, {
      method: 'POST', body: opts,
    }),

  // Ticket de caja enviando todos los datos desde el frontend
  // Usar DESPUÉS de cerrar la venta (los orders ya no existen en BD)
  printCashDirect: (opts: {
    printerName: string;
    restaurantName: string;
    tableNumber: number;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
    amountPaid: number;
    paymentMethod: string;
    notes?: string | null;
  }) =>
    request<{ ok: boolean; message: string }>('/printing/cash-direct', {
      method: 'POST', body: opts,
    }),

  printTableAccount: (tableId: number, opts: Omit<PrintOrderOptions, 'isKitchenTicket'>) =>
    request<{ ok: boolean; message: string }>(`/printing/tables/${tableId}/account`, {
      method: 'POST', body: opts,
    }),
};
