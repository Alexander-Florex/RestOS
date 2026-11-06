// ──────────────────────────────────────────────
// planillas/parse.ts — Lectura de las planillas del cliente (tarea 2.9)
//
// Solo lee: devuelve lo que dice cada celda, con la fórmula resuelta a su
// origen (fila de Insumos, otra receta o precio escrito a mano). Las
// decisiones (qué presentación vale, qué nombre usar) están en plan.ts.
//
// Diseño real de las hojas de receta (verificado en el archivo del cliente):
//   C7 nombre · C8 rendimiento (texto o número) · H9 porciones · H10 costo unitario
//   H11 margen · H13 IVA · filas 21–47: B ingrediente, C costo de la presentación,
//   D/E cantidad y unidad de la presentación, F/G cantidad y unidad usadas, H costo.
// ──────────────────────────────────────────────
import ExcelJS from 'exceljs';

export const SKIPPED_SHEETS = ['Hoja1', '- AYUDA -', 'Costo de recetas', 'Insumos', 'Modelo'];
const FIRST_LINE = 21;
const LAST_LINE = 47;

export type CostSource =
  /** D = precio de la presentación; E = precio unitario (ej. el huevo, no el maple) */
  | { kind: 'insumo'; row: number; col: 'D' | 'E' }
  /** Celda de otra hoja de receta (H10 costo unitario, H12/H14 precios, H18 costo total) */
  | { kind: 'sub'; sheet: string; cell: string }
  | { kind: 'manual'; price: number }
  | { kind: 'none' };

export interface RawInsumo {
  row: number;
  name: string;
  price: number | null;
  /** Textos de E, F y G ("x 1kg", "25 kilos", "Maple") */
  texts: string[];
  /** Si E o F calculan el precio unitario dividiendo D (ej. =+D11/25 → 25) */
  divisor: number | null;
  section: string;
  /** Zona "concentrador" (lista mayorista por caja): solo para comparar precios */
  concentrador: boolean;
}

export interface SecondaryPrice {
  source: 'Hoja1' | 'concentrador';
  row: number;
  name: string;
  /** Precio por kg / litro / unidad según la planilla */
  price: number;
}

export interface RawLine {
  row: number;
  name: string | null;
  cost: number | null;
  source: CostSource;
  presQty: number | null;
  presUnit: string | null;
  qty: number | null;
  unit: string | null;
}

export interface RawRecipe {
  sheet: string;
  title: string | null;
  yieldText: unknown;
  portions: number | null;
  unitCost: number | null;
  margin: number | null;
  vat: number | null;
  lines: RawLine[];
  /** Filas que H10 suma por plato aparte de la tanda (ej. H10 = H8/H9+H26) */
  perPortionRows: number[];
  /** Filas que suma el total (H18 = SUM(H21:H25)); null si no se entiende */
  sumRange: [number, number] | null;
}

export interface RawStockSection {
  title: string;
  items: { name: string; row: number; position: number }[];
}

export interface RawWorkbooks {
  insumos: RawInsumo[];
  secondary: SecondaryPrice[];
  recipes: RawRecipe[];
  stock: RawStockSection[];
}

// ── Celdas ──

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o || 'result' in o) return o.result ?? null;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map(r => r.text).join('');
    if ('error' in o) return null;
    if ('text' in o) return o.text;
  }
  return v ?? null;
}

function cellFormula(cell: ExcelJS.Cell): string | null {
  const v = cell.value as unknown;
  if (!v || typeof v !== 'object') return null;
  try {
    const f = cell.formula; // en fórmulas compartidas devuelve la traducida a esta celda
    if (typeof f === 'string' && f) return f;
  } catch { /* sin fórmula */ }
  const o = v as Record<string, unknown>;
  return typeof o.formula === 'string' ? o.formula : null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/\$/g, '');
    if (/^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  }
  return null;
}

export function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

// ── Origen del costo de una línea ──

const SHEET_REF = /(?:'((?:[^']|'')+)'|([A-Za-zÀ-ÿ0-9_.]+))!\$?([A-Z]+)\$?(\d+)/;

/** Sigue la fórmula de la celda de costo hasta su origen (Insumos, otra receta o un número). */
function resolveCost(wb: ExcelJS.Workbook, cell: ExcelJS.Cell, depth = 0): { source: CostSource; cost: number | null } {
  const value = num(cellValue(cell));
  const formula = cellFormula(cell);
  if (!formula) return { source: value !== null ? { kind: 'manual', price: value } : { kind: 'none' }, cost: value };

  const ins = formula.match(/Insumos!\$?([DE])\$?(\d+)/i);
  if (ins) return { source: { kind: 'insumo', row: Number(ins[2]), col: ins[1].toUpperCase() as 'D' | 'E' }, cost: value };

  const ref = formula.match(SHEET_REF);
  if (ref) {
    const sheet = (ref[1] ?? ref[2]).replace(/''/g, "'");
    const col = ref[3];
    const row = Number(ref[4]);
    // Otra celda suelta de Insumos (ej. Insumos!H138, un precio anotado al costado): precio a mano
    if (sheet.toLowerCase() === 'insumos') {
      return { source: value !== null ? { kind: 'manual', price: value } : { kind: 'none' }, cost: value };
    }
    if (col === 'H') return { source: { kind: 'sub', sheet, cell: `H${row}` }, cost: value };
    // Vínculo a la celda de costo de una línea de otra receta (ej. Volcán → Brownie!C21): seguirlo
    const target = wb.getWorksheet(sheet);
    if (target && depth < 5) {
      const r = resolveCost(wb, target.getCell(`${col}${row}`), depth + 1);
      return { source: r.source, cost: value ?? r.cost };
    }
  }
  // Fórmula sin vínculos (ej. =8787*1.21): es un precio escrito a mano
  return { source: value !== null ? { kind: 'manual', price: value } : { kind: 'none' }, cost: value };
}

// ── Hojas ──

/** "=+D11/25" o "=+D215/(15*12)" → 25 / 180 (precio por unidad = D / divisor). */
function divisorOf(formula: string | null, row: number): number | null {
  if (!formula) return null;
  const m = formula.match(new RegExp(`D\\$?${row}\\s*/\\s*\\(?\\s*([\\d.]+)(?:\\s*\\*\\s*([\\d.]+))?`));
  if (!m) return null;
  const d = Number(m[1]) * (m[2] ? Number(m[2]) : 1);
  return d > 0 ? d : null;
}

function readInsumos(wb: ExcelJS.Workbook): { insumos: RawInsumo[]; concentrador: SecondaryPrice[] } {
  const ws = wb.getWorksheet('Insumos');
  if (!ws) throw new Error('La planilla de costos no tiene la hoja "Insumos"');
  const insumos: RawInsumo[] = [];
  const concentrador: SecondaryPrice[] = [];
  let section = '';
  let inConcentrador = false;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = text(cellValue(row.getCell('B')));
    if (!name || /^insumos$/i.test(name)) continue;
    const dCell = row.getCell('D');
    const price = num(cellValue(dCell));
    const others = ['E', 'F', 'G'].map(c => cellValue(row.getCell(c)));
    // Título de sección: sin precio y sin nada al lado ("LACTEOS", "Frutas (concentrador)")
    if (price === null && (name === name.toUpperCase() || /concentrador/i.test(name))) {
      section = name;
      inConcentrador = /concentrador/i.test(name);
      continue;
    }
    const divisor = divisorOf(cellFormula(row.getCell('E')), r) ?? divisorOf(cellFormula(row.getCell('F')), r);
    if (inConcentrador) {
      // Concentrador: D = precio de la caja, F = precio por kg o unidad
      const perUnit = num(cellValue(row.getCell('F')));
      if (perUnit !== null) concentrador.push({ source: 'concentrador', row: r, name, price: perUnit });
      continue;
    }
    insumos.push({
      row: r, name, price, divisor, section, concentrador: false,
      texts: others.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim()),
    });
  }
  return { insumos, concentrador };
}

function readHoja1(wb: ExcelJS.Workbook): SecondaryPrice[] {
  const ws = wb.getWorksheet('Hoja1');
  if (!ws) return [];
  const out: SecondaryPrice[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const name = text(cellValue(ws.getCell(`A${r}`)));
    const price = num(cellValue(ws.getCell(`B${r}`)));
    if (name && price !== null) out.push({ source: 'Hoja1', row: r, name, price });
  }
  return out;
}

function readRecipes(wb: ExcelJS.Workbook): RawRecipe[] {
  const recipes: RawRecipe[] = [];
  for (const ws of wb.worksheets) {
    if (SKIPPED_SHEETS.includes(ws.name)) continue;
    const g = (addr: string) => cellValue(ws.getCell(addr));
    const lines: RawLine[] = [];
    for (let r = FIRST_LINE; r <= LAST_LINE; r++) {
      const name = text(g(`B${r}`));
      const qty = num(g(`F${r}`));
      const { source, cost } = resolveCost(wb, ws.getCell(`C${r}`));
      // Fila vacía (las plantillas traen D/E/G precargados): se ignora sin avisar
      if (!name && qty === null && source.kind === 'none') continue;
      lines.push({
        row: r, name, cost, source,
        presQty: num(g(`D${r}`)), presUnit: text(g(`E${r}`)),
        qty, unit: text(g(`G${r}`)),
      });
    }
    const h10 = cellFormula(ws.getCell('H10')) ?? '';
    const perPortionRows = h10.includes('/')
      ? [...h10.slice(h10.indexOf('/')).matchAll(/\+\s*\$?H\$?(\d+)/g)].map(m => Number(m[1]))
      : [];
    const sum = (cellFormula(ws.getCell('H18')) ?? '').match(/SUM\(\$?H\$?(\d+):\$?H\$?(\d+)\)/i);
    recipes.push({
      sheet: ws.name,
      perPortionRows,
      sumRange: sum ? [Number(sum[1]), Number(sum[2])] : null,
      title: text(g('C7')),
      yieldText: g('C8'),
      portions: num(g('H9')),
      unitCost: num(g('H10')),
      margin: num(g('H11')),
      vat: num(g('H13')),
      lines,
    });
  }
  return recipes;
}

function readStock(wb: ExcelJS.Workbook): RawStockSection[] {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('La planilla de stock está vacía');
  const sections: RawStockSection[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const name = text(cellValue(ws.getCell(`A${r}`)));
    if (!name) continue;
    // Títulos de sección: en mayúsculas ("CAMARA/HELADERA (lacteos,vegetales,etc)")
    const head = name.replace(/\(.*\)/, '').trim();
    if (head && head === head.toUpperCase() && /[A-Z]/.test(head)) {
      sections.push({ title: name, items: [] });
      continue;
    }
    const current = sections.at(-1);
    if (!current) continue; // ítems antes del primer título: no hay sector, se ignoran
    current.items.push({ name, row: r, position: current.items.length + 1 });
  }
  return sections;
}

/** Lee dos libros ya abiertos (los tests los arman en memoria). */
export function parseWorkbooks(costs: ExcelJS.Workbook, stock: ExcelJS.Workbook): RawWorkbooks {
  const { insumos, concentrador } = readInsumos(costs);
  return {
    insumos,
    secondary: [...readHoja1(costs), ...concentrador],
    recipes: readRecipes(costs),
    stock: readStock(stock),
  };
}

export async function readWorkbooks(costsPath: string, stockPath: string): Promise<RawWorkbooks> {
  const costs = new ExcelJS.Workbook();
  await costs.xlsx.readFile(costsPath);
  const stock = new ExcelJS.Workbook();
  await stock.xlsx.readFile(stockPath);
  return parseWorkbooks(costs, stock);
}
