// ──────────────────────────────────────────────
// useOrderCart.ts — Carrito de un pedido (mozo, panel y para llevar)
//
// Cada línea es plato + opciones + nota: "2x César" y "1x César SIN croutones"
// son líneas distintas. Agregar lo mismo otra vez suma cantidad a esa línea.
// ──────────────────────────────────────────────
import { useCallback, useMemo, useState } from 'react';
import type { MenuItem } from '../lib/api';
import { defaultOptionIds, lineKey, unitPrice } from '../lib/modifiers';

export interface CartLine {
  key: string;
  menuItem: MenuItem;
  quantity: number;
  optionIds: number[];
  notes: string;
  /** Estimado en pantalla; el precio que vale lo calcula el servidor. */
  unitPrice: number;
}

export interface AddLineOptions {
  optionIds?: number[];
  notes?: string;
  quantity?: number;
}

export function useOrderCart() {
  const [lines, setLines] = useState<Map<string, CartLine>>(new Map());

  const add = useCallback((menuItem: MenuItem, opts: AddLineOptions = {}) => {
    const optionIds = opts.optionIds ?? defaultOptionIds(menuItem);
    const notes = (opts.notes ?? '').trim();
    const quantity = opts.quantity ?? 1;
    const key = lineKey(menuItem.id, optionIds, notes);
    setLines(prev => {
      const next = new Map(prev);
      const current = next.get(key);
      next.set(key, current
        ? { ...current, quantity: current.quantity + quantity }
        : { key, menuItem, quantity, optionIds, notes, unitPrice: unitPrice(menuItem, optionIds) });
      return next;
    });
  }, []);

  const adjust = useCallback((key: string, delta: number) => {
    setLines(prev => {
      const current = prev.get(key);
      if (!current) return prev;
      const next = new Map(prev);
      const quantity = current.quantity + delta;
      if (quantity <= 0) next.delete(key);
      else next.set(key, { ...current, quantity });
      return next;
    });
  }, []);

  /** Reemplaza una línea (al editar sus opciones o su nota). */
  const replace = useCallback((oldKey: string, menuItem: MenuItem, opts: Required<AddLineOptions>) => {
    setLines(prev => {
      const next = new Map(prev);
      next.delete(oldKey);
      const key = lineKey(menuItem.id, opts.optionIds, opts.notes.trim());
      const current = next.get(key);
      next.set(key, current
        ? { ...current, quantity: current.quantity + opts.quantity }
        : { key, menuItem, quantity: opts.quantity, optionIds: opts.optionIds, notes: opts.notes.trim(), unitPrice: unitPrice(menuItem, opts.optionIds) });
      return next;
    });
  }, []);

  const clear = useCallback(() => setLines(new Map()), []);

  const list = useMemo(() => [...lines.values()], [lines]);
  const count = useMemo(() => list.reduce((s, l) => s + l.quantity, 0), [list]);
  const total = useMemo(
    () => list.reduce((s, l) => s + Math.round(l.unitPrice * 100) * l.quantity, 0) / 100,
    [list],
  );

  /** Líneas de un plato, en el orden en que se agregaron. */
  const linesOf = useCallback((menuItemId: number) => list.filter(l => l.menuItem.id === menuItemId), [list]);

  /** Lo que espera la API (ordersApi.create / takeawayApi.create). */
  const toRequestItems = useCallback(() => list.map(l => ({
    menuItemId: l.menuItem.id,
    quantity: l.quantity,
    notes: l.notes || undefined,
    optionIds: l.optionIds.length ? l.optionIds : undefined,
  })), [list]);

  return { lines: list, count, total, add, adjust, replace, clear, linesOf, toRequestItems };
}
