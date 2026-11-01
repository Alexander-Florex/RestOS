// ──────────────────────────────────────────────
// modifiers.ts — Personalización de platos en pantalla (tarea 5.7)
//
// Las opciones elegidas viajan como optionIds:
//   - grupo "sacar" (REMOVE): los ingredientes que el cliente NO quiere
//   - grupo "elegir" (SINGLE): la opción elegida
//   - grupo "agregados" (MULTI): los agregados
// El precio que se muestra acá es una estimación: el que vale lo calcula el servidor.
// ──────────────────────────────────────────────
import type { ItemModifier, MenuItem, MenuOptionGroup } from './api';

export function hasOptions(item: MenuItem): boolean {
  return (item.optionGroups?.length ?? 0) > 0;
}

/** ¿Hay que abrir el selector sí o sí? (hay algo obligatorio sin opción por defecto) */
export function needsChoice(item: MenuItem): boolean {
  return (item.optionGroups ?? []).some(g =>
    g.required && (g.type === 'MULTI' || !g.options.some(o => o.isDefault)));
}

/** Selección inicial: lo que viene elegido de entrada (nada se saca de entrada). */
export function defaultOptionIds(item: MenuItem): number[] {
  return (item.optionGroups ?? [])
    .filter(g => g.type !== 'REMOVE')
    .flatMap(g => g.options.filter(o => o.isDefault).map(o => o.id));
}

/** Grupos obligatorios sin elegir. */
export function missingRequired(item: MenuItem, optionIds: number[]): MenuOptionGroup[] {
  const chosen = new Set(optionIds);
  return (item.optionGroups ?? []).filter(g =>
    g.required && g.type !== 'REMOVE' && !g.options.some(o => chosen.has(o.id)));
}

/** Precio unitario estimado: plato + recargos de elegir/agregados. */
export function unitPrice(item: MenuItem, optionIds: number[]): number {
  const chosen = new Set(optionIds);
  let cents = Math.round(Number(item.price) * 100);
  for (const g of item.optionGroups ?? []) {
    if (g.type === 'REMOVE') continue;
    for (const o of g.options) if (chosen.has(o.id)) cents += Math.round(Number(o.priceDelta) * 100);
  }
  return cents / 100;
}

/** Copia de lo elegido, igual a la que guarda el servidor (para mostrar antes de enviar). */
export function selectionModifiers(item: MenuItem, optionIds: number[]): ItemModifier[] {
  const chosen = new Set(optionIds);
  const out: ItemModifier[] = [];
  for (const g of item.optionGroups ?? []) {
    for (const o of g.options) {
      if (!chosen.has(o.id)) continue;
      out.push({
        groupId: g.id, group: g.name, kind: g.type, optionId: o.id, option: o.name,
        priceDelta: g.type === 'REMOVE' ? '0.00' : o.priceDelta,
      });
    }
  }
  return out;
}

/** "SIN croutones", "Término: A punto", "+ Extra queso" */
export function modifierLabels(mods: ItemModifier[] | null | undefined): string[] {
  return (mods ?? []).map(m =>
    m.kind === 'REMOVE' ? `SIN ${m.option}` : m.kind === 'SINGLE' ? `${m.group}: ${m.option}` : `+ ${m.option}`);
}

/** Clave de una línea del carrito: mismo plato + mismas opciones + misma nota = misma línea. */
export function lineKey(menuItemId: number, optionIds: number[], notes?: string): string {
  return `${menuItemId}|${[...optionIds].sort((a, b) => a - b).join(',')}|${(notes ?? '').trim().toLowerCase()}`;
}
