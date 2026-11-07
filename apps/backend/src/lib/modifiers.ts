// ──────────────────────────────────────────────
// modifiers.ts — Personalización de platos al pedir (tarea 5.7)
//
// El cliente manda, por cada plato, los ids de las opciones elegidas:
//   - grupo REMOVE ("sacar"):  las que el cliente NO quiere ("SIN croutones")
//   - grupo SINGLE ("elegir"): la elegida ("Término: a punto")
//   - grupo MULTI ("agregar"): los agregados ("+ Extra queso")
// El servidor valida contra la carta, calcula el precio (nunca se confía en el
// precio del cliente) y guarda una copia (snapshot) en el ítem del pedido.
// ──────────────────────────────────────────────
import type { MenuItem, MenuItemOption, MenuItemOptionGroup, MenuOptionGroupType, Prisma } from '@prisma/client';
import { HttpError } from './http-error.js';
import { toCents, fromCents } from './money.js';

export type MenuItemWithOptions = MenuItem & {
  optionGroups: Array<MenuItemOptionGroup & { options: MenuItemOption[] }>;
};

/** Include de Prisma para traer los grupos y opciones de un plato, en orden. */
export const optionGroupsInclude = {
  optionGroups: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  },
} satisfies Prisma.MenuItemInclude;

/** Lo que se guarda en OrderItem/TakeawayItem/SaleItem.modifiers. */
export interface ModifierSnapshot {
  groupId: number;
  group: string;
  kind: MenuOptionGroupType;
  optionId: number;
  option: string;
  /** Recargo por unidad, "150.00". En REMOVE siempre "0.00". */
  priceDelta: string;
}

export interface ResolvedItem {
  modifiers: ModifierSnapshot[];
  /** Precio unitario final en centavos: plato + recargos. */
  unitPriceCents: number;
}

/**
 * Valida las opciones elegidas para un plato y calcula su precio unitario.
 * Si un grupo obligatorio de "elegir uno" no vino, usa la opción marcada por
 * defecto (pantallas viejas que no conocen las opciones); si no hay, rechaza.
 */
export function resolveItemOptions(menuItem: MenuItemWithOptions, optionIds: number[] = []): ResolvedItem {
  const byId = new Map<number, { group: MenuItemOptionGroup; option: MenuItemOption }>();
  for (const group of menuItem.optionGroups) {
    for (const option of group.options) byId.set(option.id, { group, option });
  }

  if (new Set(optionIds).size !== optionIds.length) {
    throw HttpError.badRequest(`Hay opciones repetidas en "${menuItem.name}"`);
  }
  for (const id of optionIds) {
    if (!byId.has(id)) {
      throw HttpError.badRequest(`Una opción elegida para "${menuItem.name}" ya no existe. Volvé a elegirla.`);
    }
  }

  const chosen = new Set(optionIds);
  const modifiers: ModifierSnapshot[] = [];
  let unitPriceCents = toCents(menuItem.price);

  for (const group of menuItem.optionGroups) {
    let picked = group.options.filter(o => chosen.has(o.id));

    if (group.type === 'SINGLE') {
      if (picked.length > 1) {
        throw HttpError.badRequest(`En "${menuItem.name}" elegí una sola opción de "${group.name}"`);
      }
      if (picked.length === 0 && group.required) {
        const fallback = group.options.find(o => o.isDefault);
        if (!fallback) throw HttpError.badRequest(`Elegí "${group.name}" para "${menuItem.name}"`);
        picked = [fallback];
      }
    }
    if (group.type === 'MULTI' && group.required && picked.length === 0) {
      throw HttpError.badRequest(`Elegí al menos una opción de "${group.name}" para "${menuItem.name}"`);
    }

    for (const option of picked) {
      const deltaCents = group.type === 'REMOVE' ? 0 : toCents(option.priceDelta);
      unitPriceCents += deltaCents;
      modifiers.push({
        groupId: group.id,
        group: group.name,
        kind: group.type,
        optionId: option.id,
        option: option.name,
        priceDelta: fromCents(deltaCents).toFixed(2),
      });
    }
  }

  if (unitPriceCents < 0) throw HttpError.badRequest(`El precio de "${menuItem.name}" no puede ser negativo`);
  return { modifiers, unitPriceCents };
}

/** Lee el JSON guardado sin confiar en su forma (datos viejos o vacíos → []). */
export function parseModifiers(value: unknown): ModifierSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is ModifierSnapshot =>
    !!m && typeof m === 'object' && typeof (m as ModifierSnapshot).option === 'string');
}

/** Líneas para la comanda y el ticket: "SIN croutones", "Término: A punto", "+ Extra queso". */
export function modifierLines(value: unknown): string[] {
  return parseModifiers(value).map((m) => {
    if (m.kind === 'REMOVE') return `SIN ${m.option}`;
    if (m.kind === 'SINGLE') return `${m.group}: ${m.option}`;
    return `+ ${m.option}`;
  });
}

/** Clave para agrupar líneas iguales (mismo plato, mismas opciones). */
export function modifiersKey(value: unknown): string {
  return parseModifiers(value).map(m => m.optionId).sort((a, b) => a - b).join(',');
}

/** Opciones + nota en un solo texto (para agentes de impresión que solo muestran `notes`). */
export function itemNotesForPrint(modifiers: unknown, notes: string | null | undefined): string | null {
  const parts = [...modifierLines(modifiers), ...(notes ? [notes] : [])];
  return parts.length ? parts.join(' · ') : null;
}
