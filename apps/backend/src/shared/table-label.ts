// ──────────────────────────────────────────────
// table-label.ts — Cómo se nombra una mesa en pantallas y tickets.
//
// El local llama a las mesas por nombre ("Ventana", "Patio 2"); el número queda
// como identificador interno (ventas, reportes). Cada restaurante elige si se
// muestran por nombre (por defecto) o por número. Sin nombre, siempre "Mesa 5".
// Compartido con el frontend por `@shared/table-label`: sin imports.
// ──────────────────────────────────────────────
export type TableLabelMode = 'NAME' | 'NUMBER';

export interface LabelableTable {
  number: number;
  name?: string | null;
}

/** Nombre de la mesa para mostrar: "Ventana" o "Mesa 5". */
export function tableLabel(t: LabelableTable, mode: TableLabelMode = 'NAME'): string {
  const name = t.name?.trim();
  return mode === 'NAME' && name ? name : `Mesa ${t.number}`;
}

/** Varias mesas juntas (mesas unidas): "Ventana + Patio 2". */
export function tablesLabel(tables: LabelableTable[], mode: TableLabelMode = 'NAME'): string {
  return [...tables].sort((a, b) => a.number - b.number).map(t => tableLabel(t, mode)).join(' + ');
}

/** Normaliza el nombre que escribe el usuario: sin espacios de más; vacío = sin nombre. */
export function normalizeTableName(name: string | null | undefined): string | null {
  const n = (name ?? '').replace(/\s+/g, ' ').trim();
  return n ? n : null;
}
