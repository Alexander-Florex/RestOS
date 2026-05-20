// ──────────────────────────────────────────────
// api.ts — Cliente REST para la appDB del servidor
// ──────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API error');
  }
  return res.json();
}

// ── Tables ──────────────────────────────────────────────────
export const tablesApi = {
  getAll: () => request<Table[]>('/tables'),
  create: (data: Omit<Table, 'id'>) =>
    request<Table>('/tables', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Table>) =>
    request<Table>(`/tables/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/tables/${id}`, { method: 'DELETE' }),
  addOrders: (id: number, orders: OrderItem[]) =>
    request<Table>(`/tables/${id}/orders`, {
      method: 'POST',
      body: JSON.stringify({ orders }),
    }),
};

// ── Menu ────────────────────────────────────────────────────
export const menuApi = {
  getAll: () => request<MenuItem[]>('/menu'),
  create: (data: Omit<MenuItem, 'id'>) =>
    request<MenuItem>('/menu', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<MenuItem>) =>
    request<MenuItem>(`/menu/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/menu/${id}`, { method: 'DELETE' }),
};

// ── Staff ───────────────────────────────────────────────────
export const staffApi = {
  getAll: () => request<StaffMember[]>('/staff'),
  create: (data: Omit<StaffMember, 'id'>) =>
    request<StaffMember>('/staff', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<StaffMember>) =>
    request<StaffMember>(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/staff/${id}`, { method: 'DELETE' }),
};

// ── Inventory ────────────────────────────────────────────────
export const inventoryApi = {
  getAll: () => request<InventoryItem[]>('/inventory'),
  create: (data: Omit<InventoryItem, 'id'>) =>
    request<InventoryItem>('/inventory', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<InventoryItem>) =>
    request<InventoryItem>(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/inventory/${id}`, { method: 'DELETE' }),
};

// ── Sales ────────────────────────────────────────────────────
export const salesApi = {
  getAll: () => request<SaleRecord[]>('/sales'),
  create: (data: Omit<SaleRecord, 'id' | 'createdAt'>) =>
    request<SaleRecord>('/sales', { method: 'POST', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/sales/${id}`, { method: 'DELETE' }),
};

// ── Shared Types ─────────────────────────────────────────────
export interface OrderItem {
  item: string;
  quantity: number;
  price: number;
}

export interface Table {
  id: number;
  number: number;
  status: 'available' | 'occupied' | 'bill-requested' | 'reserved';
  guestCount?: number | null;
  occupiedTime?: number | null;
  orders?: OrderItem[];
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string;
  stock: 'in-stock' | 'low-stock' | 'out-of-stock';
  enabled: boolean;
}

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  role: 'waiter' | 'chef' | 'manager' | 'cashier';
  phone: string;
  status: 'active' | 'inactive';
}

export interface InventoryItem {
  id: number;
  name: string;
  category: 'food' | 'beverage' | 'supplies' | 'equipment';
  quantity: number;
  unit: string;
  minStock: number;
  supplier: string;
  lastRestocked: string;
}

export interface SaleRecord {
  id: number;
  tableNumber: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  amount: number;
  total: number;
  closedAt: string;
  notes?: string;
  imageBase64?: string;
  imageName?: string;
  registeredBy?: string;
  createdAt: string;
}
