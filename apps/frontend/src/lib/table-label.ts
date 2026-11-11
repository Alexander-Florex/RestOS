// ──────────────────────────────────────────────
// table-label.ts — Cómo se nombran las mesas en todas las pantallas.
//
// El restaurante elige "por nombre" (por defecto) o "por número". La opción llega
// con la lista de mesas y por socket; se recuerda en el dispositivo para que la
// primera pantalla ya salga bien. Las reglas viven en @shared/table-label.
// ──────────────────────────────────────────────
import { useSyncExternalStore } from 'react';
import { tableLabel as label, tablesLabel as labels, type LabelableTable, type TableLabelMode } from '@shared/table-label';

export type { TableLabelMode };

const KEY = 'restos.tableLabelMode';
let mode: TableLabelMode = (() => {
  try { return localStorage.getItem(KEY) === 'NUMBER' ? 'NUMBER' : 'NAME'; } catch { return 'NAME'; }
})();
const listeners = new Set<() => void>();

export function getTableLabelMode(): TableLabelMode { return mode; }

export function setTableLabelMode(next: TableLabelMode) {
  if (next !== 'NAME' && next !== 'NUMBER') return;
  if (next === mode) return;
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* sin almacenamiento: queda en memoria */ }
  listeners.forEach(l => l());
}

/** Re-renderiza el componente cuando cambia la opción. */
export function useTableLabelMode(): TableLabelMode {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => mode,
  );
}

/** "Ventana" o "Mesa 5", según la opción del restaurante. */
export function tableLabel(t: LabelableTable): string { return label(t, mode); }

/** Mesas unidas: "Ventana + Patio". */
export function tablesLabel(ts: LabelableTable[]): string { return labels(ts, mode); }

/** Texto grande de la tarjeta del mapa: el nombre, o el número con dos cifras. */
export function tableBadge(t: LabelableTable): string {
  const name = t.name?.trim();
  return mode === 'NAME' && name ? name : String(t.number).padStart(2, '0');
}

/** ¿La tarjeta muestra un nombre (texto largo) en vez del número? */
export function showsName(t: LabelableTable): boolean {
  return mode === 'NAME' && !!t.name?.trim();
}
