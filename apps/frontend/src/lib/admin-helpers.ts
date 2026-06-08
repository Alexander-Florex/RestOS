// ──────────────────────────────────────────────
// admin-helpers.ts — Labels y estilos de inventario y staff
// ──────────────────────────────────────────────
import { Apple, GlassWater, Package, Wrench } from 'lucide-react';
import type { InventoryCategory, InventoryItem, StaffRole } from './api';

// ── Inventario ──
export const INVENTORY_CATEGORY_LABEL: Record<InventoryCategory, string> = {
  FOOD:      'Alimentos',
  BEVERAGE:  'Bebidas',
  SUPPLIES:  'Insumos',
  EQUIPMENT: 'Equipo',
};

export const INVENTORY_CATEGORY_OPTIONS = [
  { value: 'FOOD'      as InventoryCategory, label: 'Alimentos' },
  { value: 'BEVERAGE'  as InventoryCategory, label: 'Bebidas' },
  { value: 'SUPPLIES'  as InventoryCategory, label: 'Insumos' },
  { value: 'EQUIPMENT' as InventoryCategory, label: 'Equipo' },
] as const;

export const INVENTORY_CATEGORY_ICON: Record<InventoryCategory, typeof Apple> = {
  FOOD:      Apple,
  BEVERAGE:  GlassWater,
  SUPPLIES:  Package,
  EQUIPMENT: Wrench,
};

export const INVENTORY_CATEGORY_STYLE: Record<InventoryCategory, { text: string; bg: string; border: string }> = {
  FOOD:      { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  BEVERAGE:  { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30'    },
  SUPPLIES:  { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  EQUIPMENT: { text: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30'  },
};

/** Calcula el nivel de stock relativo al mínimo. */
export type StockLevel = 'OK' | 'LOW' | 'OUT';
export function stockLevel(item: InventoryItem): StockLevel {
  if (item.quantity <= 0) return 'OUT';
  if (item.minStock > 0 && item.quantity < item.minStock) return 'LOW';
  return 'OK';
}

export const STOCK_LEVEL_STYLE: Record<StockLevel, { text: string; bg: string; border: string; dot: string; label: string }> = {
  OK:  { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500',                label: 'OK'         },
  LOW: { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-500 animate-pulse',    label: 'Stock bajo' },
  OUT: { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    dot: 'bg-rose-500',                   label: 'Agotado'    },
};

// ── Staff ──
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  WAITER:  'Mesero',
  CHEF:    'Cocinero',
  MANAGER: 'Encargado',
  CASHIER: 'Cajero',
};

export const STAFF_ROLE_OPTIONS = [
  { value: 'WAITER'  as StaffRole, label: 'Mesero' },
  { value: 'CHEF'    as StaffRole, label: 'Cocinero' },
  { value: 'MANAGER' as StaffRole, label: 'Encargado' },
  { value: 'CASHIER' as StaffRole, label: 'Cajero' },
] as const;

export const STAFF_ROLE_STYLE: Record<StaffRole, { text: string; bg: string; border: string }> = {
  WAITER:  { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30'    },
  CHEF:    { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  MANAGER: { text: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30'  },
  CASHIER: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
};

/** Devuelve "JG" desde "Juan García". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
