// ──────────────────────────────────────────────
// units.ts — Unidades y conversión (tarea 2.1)
//
// Compartido con el frontend (alias @shared/units): sin imports ni dependencias.
//
// Tres familias: masa (g, kg), volumen (ml, cc, l) y conteo (un, docena,
// maple = 30). Dentro de una familia se convierte siempre; entre familias
// (ej. gramos ↔ unidades) solo si el insumo define una equivalencia
// ("1 un = 60 g"). Entiende cómo están escritas en las planillas del cliente
// ("Grs", "Kg", "CC", "Un.", "UNIDAD", "lts"...).
// ──────────────────────────────────────────────

export type UnitFamily = 'mass' | 'volume' | 'count';

export const UNITS = {
  g:      { family: 'mass',   factor: 1,    label: 'g' },
  kg:     { family: 'mass',   factor: 1000, label: 'kg' },
  ml:     { family: 'volume', factor: 1,    label: 'ml' },
  cc:     { family: 'volume', factor: 1,    label: 'cc' },
  l:      { family: 'volume', factor: 1000, label: 'l' },
  un:     { family: 'count',  factor: 1,    label: 'un' },
  docena: { family: 'count',  factor: 12,   label: 'docena' },
  maple:  { family: 'count',  factor: 30,   label: 'maple (30)' },
} as const satisfies Record<string, { family: UnitFamily; factor: number; label: string }>;

export type Unit = keyof typeof UNITS;

export const UNIT_LIST = Object.keys(UNITS) as Unit[];

export const FAMILY_LABEL: Record<UnitFamily, string> = { mass: 'peso', volume: 'volumen', count: 'unidades' };

const ALIASES: Record<string, Unit> = {
  g: 'g', gr: 'g', grs: 'g', grm: 'g', grms: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  cc: 'cc', cm3: 'cc',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  un: 'un', u: 'un', ud: 'un', uds: 'un', uni: 'un', unid: 'un', unids: 'un', unidad: 'un', unidades: 'un',
  pcs: 'un', pc: 'un', pza: 'un', pzas: 'un', pieza: 'un', piezas: 'un',
  docena: 'docena', docenas: 'docena', doc: 'docena',
  maple: 'maple', maples: 'maple',
};

/** "Grs." → "g", "UNIDAD" → "un", "lts" → "l". null si no se reconoce. */
export function normalizeUnit(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  const key = raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.\s]/g, '');
  return ALIASES[key] ?? null;
}

export function unitFamily(unit: Unit): UnitFamily {
  return UNITS[unit].family;
}

/** Equivalencia de un insumo entre familias: "1 <unidad del insumo> = qty <unit>". */
export interface Equivalence {
  qty: number;
  unit: string;
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

/**
 * Convierte `qty` de `from` a `to`. Entre familias distintas usa la equivalencia
 * del insumo (definida respecto de `itemUnit`, que suele ser `to`).
 * Lanza UnitError con un mensaje para mostrar si no se puede.
 */
export function convertUnits(
  qty: number,
  fromRaw: string,
  toRaw: string,
  equivalence?: { itemUnit: string; eq: Equivalence | null } | null,
): number {
  const from = normalizeUnit(fromRaw);
  const to = normalizeUnit(toRaw);
  if (!from) throw new UnitError(`No se reconoce la unidad "${fromRaw}"`);
  if (!to) throw new UnitError(`No se reconoce la unidad "${toRaw}"`);

  if (unitFamily(from) === unitFamily(to)) {
    return (qty * UNITS[from].factor) / UNITS[to].factor;
  }

  // Entre familias: 1 itemUnit = eq.qty eq.unit
  const eq = equivalence?.eq;
  const itemUnit = equivalence ? normalizeUnit(equivalence.itemUnit) : null;
  const eqUnit = eq ? normalizeUnit(eq.unit) : null;
  if (!eq || !itemUnit || !eqUnit || !(eq.qty > 0)) {
    throw new UnitError(
      `No se puede pasar de ${FAMILY_LABEL[unitFamily(from)]} (${from}) a ${FAMILY_LABEL[unitFamily(to)]} (${to}) ` +
      `sin una equivalencia en el insumo (ej. "1 un = 60 g")`,
    );
  }
  // Llevar `from` a la familia de la equivalencia o a la del insumo, pasando por itemUnit
  if (unitFamily(from) === unitFamily(eqUnit) && unitFamily(to) === unitFamily(itemUnit)) {
    const inEqUnit = (qty * UNITS[from].factor) / UNITS[eqUnit].factor;   // ej. 120 g → 120 g
    const inItemUnit = inEqUnit / eq.qty;                                 // 120 g / 60 g = 2 un
    return (inItemUnit * UNITS[itemUnit].factor) / UNITS[to].factor;
  }
  if (unitFamily(from) === unitFamily(itemUnit) && unitFamily(to) === unitFamily(eqUnit)) {
    const inItemUnit = (qty * UNITS[from].factor) / UNITS[itemUnit].factor; // ej. 2 un
    const inEqUnit = inItemUnit * eq.qty;                                   // 2 × 60 = 120 g
    return (inEqUnit * UNITS[eqUnit].factor) / UNITS[to].factor;
  }
  throw new UnitError(`La equivalencia del insumo no sirve para pasar de ${from} a ${to}`);
}

/** ¿Se puede convertir? (para validar formularios sin lanzar) */
export function canConvert(from: string, to: string, equivalence?: { itemUnit: string; eq: Equivalence | null } | null): boolean {
  try {
    convertUnits(1, from, to, equivalence);
    return true;
  } catch {
    return false;
  }
}
