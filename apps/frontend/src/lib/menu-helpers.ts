// ──────────────────────────────────────────────
// menu-helpers.ts — Etiquetas y estilos del menú
// ──────────────────────────────────────────────
import type { StockStatus, PaymentMethod } from './api';

// Categorías conocidas (espejo del seed). Si llega una desconocida, se muestra tal cual.
export const CATEGORY_LABEL: Record<string, string> = {
  'main-dishes': 'Platos principales',
  'appetizers':  'Entradas',
  'drinks':      'Bebidas',
  'desserts':    'Postres',
};

export const CATEGORY_OPTIONS = [
  { value: 'main-dishes', label: 'Platos principales' },
  { value: 'appetizers',  label: 'Entradas' },
  { value: 'drinks',      label: 'Bebidas' },
  { value: 'desserts',    label: 'Postres' },
] as const;

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

// ── Stock ──
export const STOCK_LABEL: Record<StockStatus, string> = {
  IN_STOCK:     'Disponible',
  LOW_STOCK:    'Stock bajo',
  OUT_OF_STOCK: 'Sin stock',
};

export const STOCK_STYLE: Record<StockStatus, { text: string; bg: string; border: string; dot: string }> = {
  IN_STOCK:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' },
  LOW_STOCK:    { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-500'   },
  OUT_OF_STOCK: { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    dot: 'bg-rose-500'    },
};

// ── Método de pago ──
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH:     'Efectivo',
  CARD:     'Tarjeta',
  TRANSFER: 'Transferencia',
};

export const PAYMENT_OPTIONS = [
  { value: 'CASH'     as PaymentMethod, label: 'Efectivo' },
  { value: 'CARD'     as PaymentMethod, label: 'Tarjeta' },
  { value: 'TRANSFER' as PaymentMethod, label: 'Transferencia' },
] as const;
