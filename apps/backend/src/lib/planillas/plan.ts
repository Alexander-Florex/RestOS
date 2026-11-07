// ──────────────────────────────────────────────
// planillas/plan.ts — Qué importar y qué problemas tiene (tarea 2.9)
//
// A partir de lo leído (parse.ts) arma un plan sin tocar la base:
// - Catálogo de insumos: la hoja Insumos manda; Hoja1 y el "concentrador" solo
//   se comparan. Presentación: primero lo que dice Insumos ("25 kilos", =D11/25),
//   después la que usan las recetas, y por último "precio por kg" en carnes,
//   verduras, frutas, fiambres y quesos (avisado en el informe).
// - Stock: cada ítem de la planilla de stock se une a un insumo por nombre
//   (exacto o aproximado, avisado) y le da sector y orden de conteo.
// - Recetas: una por hoja. Las sub-recetas se costean SIEMPRE por su costo
//   (nunca por la celda de precio a la que apuntaba la planilla).
// Todo lo dudoso queda como aviso (Issue) para el informe.
// ──────────────────────────────────────────────
import { canConvert, convertUnits, unitFamily, type Unit, type UnitFamily } from '../../shared/units.js';
import { DEFAULT_STORAGE_AREAS } from '../default-storage-areas.js';
import {
  baseUnit, cleanName, contentTokens, lineUnit, nameKey, parsePresentationText, parseYieldText, type Qty,
} from './normalize.js';
import type { RawInsumo, RawLine, RawRecipe, RawWorkbooks } from './parse.js';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  /** Dónde: "Receta «Lomo Wellington» fila 22", "Insumos fila 11", "Stock «Langostinos»" */
  where: string;
  message: string;
}

export type Category = 'FOOD' | 'BEVERAGE' | 'SUPPLIES';

export interface PlannedItem {
  key: string;
  name: string;
  category: Category;
  unit: Unit;
  /** Presentación de compra con su precio (de ahí sale el costo por unidad) */
  presentation: { qty: number; unit: Unit; price: number } | null;
  costPerUnit: number | null;
  equivalence: { qty: number; unit: Unit } | null;
  areaName: string | null;
  countOrder: number | null;
  /** De dónde salió: "Insumos fila 11", "Stock: Estanterías depósito #2", "Receta «Brownie» (precio a mano)" */
  origins: string[];
  usedIn: string[];
}

export type PlannedLine =
  | { kind: 'item'; key: string; quantity: number; unit: string; sourceRow: number }
  | { kind: 'sub'; sheet: string; quantity: number; unit: string; sourceRow: number };

export interface PlannedRecipe {
  sheet: string;
  name: string;
  yield: number;
  yieldQty: number | null;
  yieldUnit: Unit | null;
  profitPct: number;
  vatPct: number;
  notes: string;
  lines: PlannedLine[];
  /** Costo por porción según la planilla (H10), para comparar */
  planillaUnitCost: number | null;
  /** Costo por porción con las reglas del sistema (calculado acá) */
  systemUnitCost: number | null;
  /** Faltan líneas (omitidas por algún problema) */
  incomplete: boolean;
}

export interface StockLink {
  stockName: string;
  section: string;
  areaName: string;
  position: number;
  itemKey: string;
  match: 'exact' | 'approx' | 'new';
}

export interface Plan {
  items: PlannedItem[];
  recipes: PlannedRecipe[];
  stock: StockLink[];
  areas: string[];
  issues: Issue[];
}

// ── Utilidades ──

const IGNORED_NAME_TOKENS = new Set(['porcion', 'placa', 'entrada']);

/** Distancia de edición (para "lagostino" ≈ "langostino", "parborizado" ≈ "parvorizado"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Dos palabras "son la misma": iguales, una abrevia a la otra (sorr/sorrentino) o casi iguales. */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return a.length >= 6 && b.length >= 6 && editDistance(a, b) <= 1;
}

/** Envases que la planilla de stock antepone al nombre ("Bolsa de papa", "Riestra de ajo", "Hoja Kale"). */
const CONTAINER_TOKENS = new Set(['bolsa', 'riestra', 'hoja', 'paq', 'paquete', 'caja', 'lata', 'frasco', 'pote']);

function stockTokens(raw: string): string[] {
  const t = contentTokens(raw);
  return t.length > 1 && CONTAINER_TOKENS.has(t[0]) ? t.slice(1) : t;
}

function fuzzyWithin(a: string[], b: string[]): boolean {
  return a.length > 0 && a.every(t => b.some(u => sameToken(t, u)));
}

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pct = (n: number) => `${Math.round(n * 100)} %`;
const qtyText = (q: { qty: number; unit: string }) => `${Number(q.qty.toFixed(3)).toLocaleString('es-AR')} ${q.unit}`;

/** Sección de la hoja Insumos donde, sin otra pista, el precio es por kilo. */
const PER_KG_SECTIONS = /(CARNE|PESCADO|MARISCO|VERDURA|FRUTA|FIAMBRE)/i;

/** Sector de la app para cada título de la planilla de stock. */
function areaForSection(title: string): string {
  const t = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const rules: [RegExp, number][] = [
    [/CARNE|PESCADO|MARISCO/, 0], [/PASTA/, 1], [/GUARNICION|SALSA/, 2], [/CAMARA|HELADERA/, 3],
    [/VEGETAL|VERDURA/, 4], [/ESTANTERIA|DEPOSITO/, 5], [/LIMPIEZA|DESCARTABLE/, 6],
  ];
  const hit = rules.find(([re]) => re.test(t));
  return hit ? DEFAULT_STORAGE_AREAS[hit[1]] : cleanName(title);
}

// ── Catálogo de insumos ──

/** Cómo usaba la planilla el insumo en una línea: precio tomado (C) por cantidad D en unidad E. */
interface PresRef { recipe: string; qty: number | null; unit: string | null; cost: number | null; ofPresentation: boolean }

interface Cand {
  key: string;
  name: string;
  price: number | null;
  insumo: RawInsumo | null;
  /** Presentación de un precio escrito a mano en una receta */
  manualPres: Qty | null;
  refs: PresRef[];
  usage: { recipe: string; unit: Unit }[];
  origins: string[];
  section: string;
  /** Resultado */
  presentation: { qty: number; unit: Unit; price: number } | null;
  unit: Unit;
  equivalence: { qty: number; unit: Unit } | null;
  costPerUnit: number | null;
  areaName: string | null;
  countOrder: number | null;
  category: Category;
  stockLinked: boolean;
  usedIn: string[];
}

function newCand(key: string, name: string, price: number | null, origin: string): Cand {
  return {
    key, name: cleanName(name), price, insumo: null, manualPres: null, refs: [], usage: [], origins: [origin],
    section: '', presentation: null, unit: 'kg', equivalence: null, costPerUnit: null,
    areaName: null, countOrder: null, category: /^\s*(vino|cerveza|gaseosa|jugo|agua)\b/i.test(name) ? 'BEVERAGE' : 'FOOD',
    stockLinked: false, usedIn: [],
  };
}

/** Presentación de una referencia de receta ("1000 Grs"). "1000 UNIDAD" con uso en gramos es un error de tipeo → g. */
function refPresentation(ref: PresRef, usageFamily: UnitFamily | null): Qty | null {
  if (!ref.qty || ref.qty <= 0) return null;
  const u = lineUnit(ref.unit);
  if (!u || u === 'porcion') return null;
  if (unitFamily(u) === 'count' && ref.qty === 1000 && usageFamily && usageFamily !== 'count') {
    return { qty: 1000, unit: usageFamily === 'mass' ? 'g' : 'ml' };
  }
  return { qty: ref.qty, unit: u };
}

function majority<T>(values: T[], key: (v: T) => string): T | null {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    const k = key(v);
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { v, n: 1 });
  }
  let best: { v: T; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.v ?? null;
}

export function buildPlan(raw: RawWorkbooks): Plan {
  const issues: Issue[] = [];
  const issue = (severity: Severity, code: string, where: string, message: string) => issues.push({ severity, code, where, message });

  // 1. Insumos de la hoja principal
  const cands = new Map<string, Cand>();
  const rowToKey = new Map<number, string>();
  for (const ins of raw.insumos) {
    const key = nameKey(ins.name);
    if (!key) continue;
    const existing = cands.get(key);
    if (existing) {
      rowToKey.set(ins.row, key);
      issue('info', 'NOMBRE_DUPLICADO', `Insumos fila ${ins.row}`,
        `«${cleanName(ins.name)}» ya estaba en la fila ${existing.insumo?.row}: se usa la primera (${existing.price !== null ? money(existing.price) : 'sin precio'}).`);
      continue;
    }
    const c = newCand(key, ins.name, ins.price, `Insumos fila ${ins.row}`);
    c.insumo = ins;
    c.section = ins.section;
    cands.set(key, c);
    rowToKey.set(ins.row, key);
  }

  // 2. Nombres de recetas (la hoja manda si C7 parece copiado de otra)
  const recipeNames = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const r of raw.recipes) {
    const sheetTokens = contentTokens(r.sheet).filter(t => !IGNORED_NAME_TOKENS.has(t));
    const title = r.title ? cleanName(r.title) : null;
    let name = r.sheet;
    if (!title) {
      issue('info', 'NOMBRE_VACIO', `Receta «${r.sheet}»`, 'C7 está vacío: se usó el nombre de la hoja.');
    } else {
      const titleTokens = contentTokens(title).filter(t => !IGNORED_NAME_TOKENS.has(t));
      const titleAdds = fuzzyWithin(sheetTokens, titleTokens) && titleTokens.length > sheetTokens.length;
      const sheetExtra = sheetTokens.filter(t => !titleTokens.some(u => sameToken(t, u)));
      const titleExtra = titleTokens.filter(t => !sheetTokens.some(u => sameToken(t, u)));
      if (titleAdds && contentTokens(r.sheet).every(t => !IGNORED_NAME_TOKENS.has(t))) {
        name = title; // "Mousse" → "Mousse Limon", "Noquis papa" → "Ñoquis de papa"
      } else if (sheetExtra.length > 0 && titleExtra.length > 0) {
        issue('warn', 'NOMBRE_COPIADO', `Receta «${r.sheet}»`,
          `C7 dice «${title}»: parece copiado de otra receta. Se usó el nombre de la hoja.`);
      }
    }
    if (usedNames.has(nameKey(name))) name = `${name} (${r.sheet})`;
    usedNames.add(nameKey(name));
    recipeNames.set(r.sheet, name);
  }
  const sheetByName = new Map(raw.recipes.map(r => [r.sheet, r]));

  // 3. Líneas: a qué insumo o sub-receta apunta cada una
  type Resolved =
    | { kind: 'item'; key: string; line: RawLine }
    | { kind: 'sub'; sheet: string; cell: string; line: RawLine };
  const resolved = new Map<string, Resolved[]>();

  for (const r of raw.recipes) {
    const rname = recipeNames.get(r.sheet)!;
    const out: Resolved[] = [];
    resolved.set(r.sheet, out);
    for (const line of r.lines) {
      const where = `Receta «${rname}» fila ${line.row}`;
      const lname = line.name ? cleanName(line.name) : null;
      if (!lname) {
        if (line.qty !== null) issue('warn', 'FILA_SIN_INGREDIENTE', where, `Tiene cantidad (${line.qty} ${line.unit ?? ''}) pero no dice qué ingrediente: se omitió.`);
        continue;
      }
      if (line.qty === null || line.qty <= 0) {
        issue('warn', 'SIN_CANTIDAD', where, `«${lname}» no tiene cantidad usada: se omitió.`);
        continue;
      }
      const lkey = nameKey(lname);
      const src = line.source;

      if (src.kind === 'sub') {
        if (!sheetByName.has(src.sheet)) {
          issue('error', 'VINCULO_ROTO', where, `«${lname}» apunta a la hoja «${src.sheet}», que no es una receta: se omitió.`);
          continue;
        }
        out.push({ kind: 'sub', sheet: src.sheet, cell: src.cell, line });
        continue;
      }

      let key: string | null = null;
      if (src.kind === 'insumo') {
        const rowKey = rowToKey.get(src.row) ?? null;
        // Se cambia el vínculo solo si el nombre de la línea no tiene nada que ver con la fila
        // a la que apunta ("Lomo" → fila de "Bife angosto") y coincide con otro insumo.
        // "Bondiola" → "Bondiola de cerdo" es el mismo: se respeta la planilla.
        const rowName = rowKey ? cands.get(rowKey)!.name : '';
        const related = rowKey !== null && (fuzzyWithin(contentTokens(lname), contentTokens(rowName))
          || fuzzyWithin(contentTokens(rowName), contentTokens(lname)));
        if (cands.has(lkey) && lkey !== rowKey && !related) {
          key = lkey;
          const rowName = rowKey ? cands.get(rowKey)!.name : `la fila ${src.row}`;
          issue('warn', 'VINCULO_A_OTRO_INSUMO', where,
            `«${lname}» tomaba el precio de «${rowName}» (Insumos fila ${src.row}). Se vinculó al insumo «${cands.get(lkey)!.name}».`);
        } else if (rowKey) {
          key = rowKey;
          const rowCand = cands.get(rowKey)!;
          if (lkey !== rowKey && !fuzzyWithin(contentTokens(lname), contentTokens(rowCand.name))
            && !fuzzyWithin(contentTokens(rowCand.name), contentTokens(lname))) {
            issue('info', 'NOMBRE_DISTINTO', where, `«${lname}» se vinculó a «${rowCand.name}» (Insumos fila ${src.row}), como en la planilla.`);
          }
        } else {
          // Fila sin insumo (título, vacía o del concentrador): se crea con el precio que traía
          key = lkey;
          if (!cands.has(key)) {
            const c = newCand(key, lname, line.cost, `Receta «${rname}» (Insumos fila ${src.row})`);
            c.manualPres = refPresentation({ recipe: rname, qty: line.presQty, unit: line.presUnit, cost: line.cost, ofPresentation: true }, null);
            cands.set(key, c);
          }
          issue('warn', 'VINCULO_ROTO', where, `«${lname}» apunta a Insumos fila ${src.row}, que no es un insumo de la lista: se creó «${lname}».`);
        }
      } else if (src.kind === 'manual') {
        key = lkey;
        const existing = cands.get(key);
        if (existing) {
          issue('info', 'PRECIO_A_MANO', where,
            `«${lname}» tiene el precio escrito a mano (${money(src.price)}); se usa el insumo «${existing.name}» (${existing.price !== null ? money(existing.price) : 'sin precio'}).`);
        } else {
          const c = newCand(key, lname, src.price, `Receta «${rname}» (precio a mano)`);
          c.manualPres = refPresentation({ recipe: rname, qty: line.presQty, unit: line.presUnit, cost: line.cost, ofPresentation: true }, null);
          cands.set(key, c);
          issue('warn', 'PRECIO_A_MANO', where,
            `«${lname}» tiene el precio escrito a mano: se creó el insumo con ${money(src.price)}${c.manualPres ? ` por ${qtyText(c.manualPres)}` : ''}.`);
        }
      } else {
        key = lkey;
        const existing = cands.get(key);
        if (existing) {
          issue('info', 'SIN_COSTO', where, `«${lname}» no tiene costo en la planilla: se usó el insumo «${existing.name}».`);
        } else {
          cands.set(key, newCand(key, lname, null, `Receta «${rname}» (sin costo)`));
          issue('warn', 'SIN_COSTO', where, `«${lname}» no tiene costo ni insumo vinculado: se creó sin precio.`);
        }
      }

      const cand = cands.get(key)!;
      if (src.kind === 'insumo' || src.kind === 'manual') {
        cand.refs.push({
          recipe: rname, qty: line.presQty, unit: line.presUnit, cost: line.cost,
          // Solo los vínculos al precio de la presentación (columna D) dicen cuál es la presentación
          ofPresentation: src.kind === 'manual' || src.col === 'D',
        });
      }
      const u = lineUnit(line.unit);
      if (u && u !== 'porcion') cand.usage.push({ recipe: rname, unit: u });
      out.push({ kind: 'item', key, line });
    }
  }

  // 4. Presentación, unidad y costo de cada insumo
  for (const c of cands.values()) {
    const usageFamily = majority(c.usage.map(u => unitFamily(u.unit)), f => f);
    let pres: Qty | null = null;
    let from: 'insumos' | 'recetas' | 'supuesto' | null = null;

    if (c.insumo) {
      const where = `Insumos fila ${c.insumo.row} «${c.name}»`;
      const fromText = c.insumo.texts.map(t => parsePresentationText(t)).find(Boolean) ?? null;
      const k = c.insumo.divisor;
      if (k) {
        if (fromText && (fromText.qty === k || fromText.qty === 1)) {
          pres = { qty: fromText.qty === k ? k : k * fromText.qty, unit: fromText.unit };
        } else if (fromText) {
          pres = { qty: k, unit: fromText.unit };
          issue('info', 'PRESENTACION_TEXTO', where, `Dice «${c.insumo.texts.join(' / ')}» pero divide el precio por ${k}: se usó ${qtyText(pres)}.`);
        } else {
          pres = { qty: k, unit: 'un' };
          issue('warn', 'PRESENTACION_SUPUESTA', where, `Divide el precio por ${k} sin decir la unidad: se supusieron ${k} unidades.`);
        }
      } else if (fromText) {
        pres = fromText;
      }
      if (pres) from = 'insumos';
    }
    if (!pres) {
      const refPres = c.refs.filter(r => r.ofPresentation).map(r => refPresentation(r, usageFamily)).filter((q): q is Qty => q !== null);
      pres = c.manualPres ?? majority(refPres, q => `${q.qty}|${q.unit}`);
      if (pres) from = 'recetas';
    }
    if (!pres && c.price !== null && (PER_KG_SECTIONS.test(c.section) || /^queso/i.test(c.name))) {
      pres = { qty: 1, unit: 'kg' };
      from = 'supuesto';
      issue('info', 'PRESENTACION_SUPUESTA', c.origins[0], `«${c.name}» no dice la presentación: se supuso precio por kg (${money(c.price)}/kg).`);
    }

    c.unit = pres ? baseUnit(unitFamily(pres.unit)) : usageFamily ? baseUnit(usageFamily) : 'kg';
    const fam = unitFamily(c.unit);
    // Se usa en peso y en volumen: la planilla los trata igual (1 l = 1 kg)
    const otherFamilies = new Set(c.usage.map(u => unitFamily(u.unit)).filter(f => f !== fam));
    if (fam !== 'count' && otherFamilies.has(fam === 'mass' ? 'volume' : 'mass')) {
      c.equivalence = { qty: 1, unit: fam === 'mass' ? 'l' : 'kg' };
      issue('info', 'EQUIVALENCIA_SUPUESTA', c.origins[0],
        `«${c.name}» se usa en peso y en volumen: se supuso 1 ${c.unit} = 1 ${c.equivalence.unit}, como hacía la planilla.`);
    }
    const eq = c.equivalence ? { itemUnit: c.unit, eq: c.equivalence } : null;

    if (c.price === null || c.price <= 0) {
      issue(c.usage.length ? 'warn' : 'info', 'SIN_PRECIO', c.origins[0], `«${c.name}» no tiene precio: queda en $0 hasta que lo cargues.`);
    } else if (!pres) {
      issue(c.usage.length ? 'warn' : 'info', 'SIN_PRESENTACION', c.origins[0],
        `«${c.name}» cuesta ${money(c.price)} pero no se sabe por qué cantidad: no se importó el precio. Cargá la presentación.`);
    } else {
      try {
        const inUnit = convertUnits(pres.qty, pres.unit, c.unit, eq);
        c.presentation = { qty: pres.qty, unit: pres.unit, price: c.price };
        c.costPerUnit = c.price / inUnit;
      } catch {
        issue('warn', 'SIN_PRESENTACION', c.origins[0], `«${c.name}»: la presentación ${qtyText(pres)} no se puede pasar a ${c.unit}.`);
      }
    }

    // La planilla calculaba con otra presentación: el costo de esas recetas cambia
    if (c.costPerUnit !== null && from !== 'supuesto') {
      // Recetas agrupadas por el precio por unidad que usaba la planilla
      const byPlanillaPrice = new Map<number, string[]>();
      for (const ref of c.refs) {
        const q = refPresentation(ref, usageFamily);
        if (!q || !canConvert(q.unit, c.unit, eq)) continue;
        if (!ref.cost || ref.cost <= 0) continue;
        const planillaPerUnit = ref.cost / convertUnits(q.qty, q.unit, c.unit, eq);
        if (Math.abs(c.costPerUnit / planillaPerUnit - 1) <= 0.01) continue;
        const k = Math.round(planillaPerUnit);
        const list = byPlanillaPrice.get(k) ?? [];
        if (!list.includes(ref.recipe)) list.push(ref.recipe);
        byPlanillaPrice.set(k, list);
      }
      if (byPlanillaPrice.size > 0) {
        const parts = [...byPlanillaPrice].map(([p, recipes]) =>
          `en ${recipes.join(', ')} la planilla usaba ${money(p)}/${c.unit} (× ${Number((c.costPerUnit! / p).toPrecision(2)).toLocaleString('es-AR')})`);
        issue('warn', 'PRESENTACION_DISTINTA', c.origins[0],
          `«${c.name}»: ${money(c.price!)} es por ${qtyText(c.presentation!)} → ${money(c.costPerUnit)}/${c.unit}. Pero ${parts.join('; ')}. Se usa ${money(c.costPerUnit)}/${c.unit}.`);
      }
    }
  }

  // 5. Comparación con Hoja1 y el concentrador (fuentes secundarias)
  for (const s of raw.secondary) {
    const c = cands.get(nameKey(s.name));
    if (!c || c.costPerUnit === null || s.price <= 0) continue;
    const diff = (s.price - c.costPerUnit) / c.costPerUnit;
    if (Math.abs(diff) > 0.15) {
      issue('info', 'PRECIO_CONTRADICTORIO', `${s.source} fila ${s.row}`,
        `«${c.name}»: Insumos da ${money(c.costPerUnit)}/${c.unit} y ${s.source} ${money(s.price)} (${diff > 0 ? '+' : ''}${pct(diff)}). Se usó Insumos.`);
    }
  }

  // 6. Planilla de stock: sector y orden de conteo
  const stock: StockLink[] = [];
  const areas: string[] = [];
  const newStockNames: string[] = [];
  for (const section of raw.stock) {
    const areaName = areaForSection(section.title);
    if (!areas.includes(areaName)) areas.push(areaName);
    // Pastas y guarniciones son elaborados: solo se unen por nombre exacto
    const elaborated = /PASTA|GUARNICION|SALSA/i.test(section.title.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    for (const it of section.items) {
      const key = nameKey(it.name);
      let cand = cands.get(key) ?? null;
      let match: StockLink['match'] = 'exact';
      if (cand?.stockLinked) cand = null;
      if (!cand && !elaborated) {
        const tokens = stockTokens(it.name);
        const hits = [...cands.values()].filter(c => {
          if (c.stockLinked) return false;
          const ct = stockTokens(c.name);
          // Misma palabra principal ("Bolsa de papa" ~ "Papa", pero "Bife de chorizo" ≠ "Chorizos")
          if (!tokens[0] || !ct[0] || !sameToken(tokens[0], ct[0])) return false;
          return fuzzyWithin(ct, tokens) || fuzzyWithin(tokens, ct);
        });
        if (hits.length === 1) { cand = hits[0]; match = 'approx'; }
        else if (hits.length > 1) {
          issue('info', 'STOCK_AMBIGUO', `Stock «${cleanName(it.name)}»`,
            `Se parece a varios insumos (${hits.map(h => h.name).join(', ')}): se creó aparte. Unilos a mano si es el mismo.`);
        }
      }
      if (!cand) {
        // Ítem solo de stock (sin precio): unidad supuesta según el sector
        const k = cands.has(key) ? `${key} (stock)` : key;
        cand = newCand(k, it.name, null, `Stock: ${areaName} #${it.position}`);
        cand.unit = /CARNE|PESCADO|GUARNICION/i.test(section.title) ? 'kg' : 'un';
        if (/LIMPIEZA|DESCARTABLE/i.test(section.title)) cand.category = 'SUPPLIES';
        cands.set(k, cand);
        match = 'new';
        newStockNames.push(`${cleanName(it.name)} (${cand.unit})`);
      } else {
        cand.origins.push(`Stock: ${areaName} #${it.position}`);
        if (match === 'approx') {
          issue('info', 'STOCK_PARECIDO', `Stock «${cleanName(it.name)}»`, `Se unió al insumo «${cand.name}» por nombre parecido. Revisalo.`);
        }
      }
      cand.stockLinked = true;
      cand.areaName = areaName;
      cand.countOrder = it.position;
      if (/LIMPIEZA|DESCARTABLE/i.test(section.title)) cand.category = 'SUPPLIES';
      stock.push({ stockName: cleanName(it.name), section: section.title, areaName, position: it.position, itemKey: cand.key, match });
    }
  }
  if (newStockNames.length > 0) {
    issue('info', 'STOCK_NUEVO', 'Planilla de stock',
      `${newStockNames.length} ítems no tienen insumo en la planilla de costos: se crean sin precio y con unidad supuesta (revisala antes del primer conteo). Detalle en items.csv.`);
  }

  // 7. Recetas: orden (sub-recetas primero), rendimiento y líneas
  const subUses = new Map<string, Set<string>>();
  for (const [sheet, lines] of resolved) {
    for (const l of lines) if (l.kind === 'sub') {
      if (!subUses.has(sheet)) subUses.set(sheet, new Set());
      subUses.get(sheet)!.add(l.sheet);
    }
  }
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (sheet: string, path: string[]) => {
    if (state.get(sheet) === 'done') return;
    if (state.get(sheet) === 'visiting') {
      issue('error', 'CICLO', `Receta «${recipeNames.get(sheet)}»`, `Se usa a sí misma: ${[...path, sheet].map(s => recipeNames.get(s)).join(' → ')}. Se quitó ese vínculo.`);
      subUses.get(path.at(-1)!)?.delete(sheet);
      return;
    }
    state.set(sheet, 'visiting');
    for (const dep of [...(subUses.get(sheet) ?? [])]) visit(dep, [...path, sheet]);
    state.set(sheet, 'done');
    order.push(sheet);
  };
  for (const r of raw.recipes) visit(r.sheet, []);

  // Rendimiento en unidades de las sub-recetas que se usan por peso o volumen
  const subYield = new Map<string, Qty>();
  for (const r of raw.recipes) {
    const fromC8 = parseYieldText(r.yieldText);
    if (fromC8) { subYield.set(r.sheet, fromC8); continue; }
    const portions = r.portions && r.portions > 0 ? r.portions : 1;
    const refs: Qty[] = [];
    for (const lines of resolved.values()) {
      for (const l of lines) {
        if (l.kind !== 'sub' || l.sheet !== r.sheet) continue;
        const u = lineUnit(l.line.presUnit);
        if (u && u !== 'porcion' && unitFamily(u) !== 'count' && l.line.presQty) refs.push({ qty: l.line.presQty * portions, unit: u });
      }
    }
    const y = majority(refs, q => `${q.qty}|${q.unit}`);
    if (y) subYield.set(r.sheet, y);
  }

  const recipes: PlannedRecipe[] = [];
  for (const sheet of order) {
    const r = sheetByName.get(sheet)!;
    const name = recipeNames.get(sheet)!;
    const where = `Receta «${name}»`;
    let incomplete = false;
    const lines: PlannedLine[] = [];

    let portions = 1;
    if (r.portions !== null && Number.isInteger(r.portions) && r.portions >= 1) portions = r.portions;
    else issue('warn', 'PORCIONES_INVALIDAS', where,
      `H9 dice ${r.portions ?? 'nada'} porciones: se puso 1.${r.unitCost !== null ? ` La planilla daba ${money(r.unitCost)} por porción.` : ''} Revisá cuántas rinde.`);

    // Algunas hojas suman líneas "por plato" aparte de la tanda: H10 = H8/H9 + H26
    const inSum = (row: number) => !r.sumRange || (row >= r.sumRange[0] && row <= r.sumRange[1]);
    const factorFor = (row: number, label: string, lw: string): number => {
      const perPlate = r.perPortionRows.includes(row);
      if (perPlate && !inSum(row)) {
        if (portions > 1) issue('info', 'POR_PLATO', lw, `«${label}» se suma por plato (H10 = H8/H9 + H${row}): se cuenta × ${portions} porciones en la receta.`);
        return portions;
      }
      if (perPlate) {
        issue('warn', 'CONTADA_DOS_VECES', lw, `«${label}» se sumaba dos veces (en el total y otra vez por plato en H10): se cuenta una sola vez.`);
      } else if (!inSum(row)) {
        issue('info', 'FUERA_DE_LA_SUMA', lw, `«${label}» no entraba en el total de la planilla (H18 suma H${r.sumRange![0]}:H${r.sumRange![1]}): se incluye.`);
      }
      return 1;
    };

    for (const l of resolved.get(sheet)!) {
      const lw = `${where} fila ${l.line.row}`;
      const u = lineUnit(l.line.unit);
      const factor = factorFor(l.line.row, cleanName(l.line.name ?? ''), lw);
      if (l.kind === 'item') {
        const c = cands.get(l.key)!;
        if (!c.usedIn.includes(name)) c.usedIn.push(name);
        if (!u || u === 'porcion') {
          issue('warn', 'SIN_UNIDAD', lw, `«${c.name}»: la unidad «${l.line.unit ?? ''}» no se reconoce: se omitió la línea.`);
          incomplete = true;
          continue;
        }
        const eq = c.equivalence ? { itemUnit: c.unit, eq: c.equivalence } : null;
        if (!canConvert(u, c.unit, eq)) {
          issue('warn', 'UNIDAD_INCOMPATIBLE', lw,
            `«${c.name}» se usa en ${u} pero el insumo está en ${c.unit}: se omitió la línea. Cargale una equivalencia (ej. 1 un = 60 g) y agregala a mano.`);
          incomplete = true;
          continue;
        }
        lines.push({ kind: 'item', key: c.key, quantity: l.line.qty! * factor, unit: u, sourceRow: l.line.row });
        continue;
      }
      // Sub-receta: siempre por su costo, nunca por el precio
      if (!subUses.get(sheet)?.has(l.sheet)) { incomplete = true; continue; } // vínculo quitado por ciclo
      const sub = sheetByName.get(l.sheet)!;
      const subName = recipeNames.get(l.sheet)!;
      if (l.cell !== 'H10') {
        const label: Record<string, string> = { H12: 'el precio sin IVA', H14: 'el precio con IVA', H18: 'el costo total', H8: 'el costo total' };
        const harmless = (l.cell === 'H18' || l.cell === 'H8') && (sub.portions ?? 1) === 1;
        issue(harmless ? 'info' : 'warn', 'SUBRECETA_MAL_VINCULADA', lw,
          `«${subName}» tomaba ${label[l.cell] ?? `la celda ${l.cell}`} (${l.line.cost !== null ? money(l.line.cost) : '?'}) en vez del costo unitario (H10${sub.unitCost !== null ? `, ${money(sub.unitCost)}` : ''}). Se usa el costo.`);
      }
      const y = subYield.get(l.sheet);
      if (u && u !== 'porcion' && unitFamily(u) !== 'count' && y && canConvert(u, y.unit)) {
        lines.push({ kind: 'sub', sheet: l.sheet, quantity: l.line.qty! * factor, unit: u, sourceRow: l.line.row });
      } else if (u && u !== 'porcion' && unitFamily(u) !== 'count' && y && unitFamily(y.unit) !== 'count') {
        // Rinde en volumen y se usa en peso (o al revés): la planilla trata 1 g = 1 cc
        const asUnit: Unit = unitFamily(y.unit) === 'volume' ? 'cc' : 'g';
        const qty = convertUnits(l.line.qty!, u, unitFamily(u) === 'mass' ? 'g' : 'cc') * factor;
        lines.push({ kind: 'sub', sheet: l.sheet, quantity: qty, unit: asUnit, sourceRow: l.line.row });
        issue('info', 'SUBRECETA_PESO_VOLUMEN', lw, `«${subName}» rinde ${qtyText(y)} y se usa en ${u}: se tomó ${qty} ${u} = ${qty} ${asUnit}, como la planilla.`);
      } else {
        // Por porción: F / D (ej. 1 UNIDAD de 1 → 1 porción; 300 Grs de 1000 → 0,3 porción)
        const per = l.line.presQty && l.line.presQty > 0 ? l.line.presQty : 1;
        lines.push({ kind: 'sub', sheet: l.sheet, quantity: Number(((l.line.qty! / per) * factor).toFixed(4)), unit: 'porcion', sourceRow: l.line.row });
        if (u && u !== 'porcion' && unitFamily(u) !== 'count') {
          issue('warn', 'SUBRECETA_POR_PORCION', lw, `No se sabe cuánto rinde «${subName}» en ${u}: se tomó ${l.line.qty}/${per} porción.`);
        }
      }
    }

    let margin = 0.5;
    if (r.margin !== null && r.margin >= 0 && r.margin <= 0.95) margin = r.margin;
    else issue('warn', 'MARGEN_INVALIDO', where, `El margen (H11) es ${r.margin ?? 'vacío'}: se puso 50 %.`);
    if (margin < 0.5) issue('info', 'MARGEN_BAJO', where, `Margen ${pct(margin)} → costo de mercadería ${pct(1 - margin)}.`);
    const vat = r.vat !== null && r.vat >= 0 && r.vat <= 0.5 ? r.vat : 0.21;
    if (r.vat !== null && Math.abs(r.vat - 0.21) > 0.001) issue('info', 'IVA_DISTINTO', where, `IVA ${pct(r.vat)} (no 21 %).`);

    if (lines.length === 0) {
      issue('error', 'RECETA_VACIA', where, 'No quedó ninguna línea válida: no se importa.');
      continue;
    }
    const y = subYield.get(sheet) ?? null;
    recipes.push({
      sheet, name, yield: portions,
      yieldQty: y?.qty ?? null, yieldUnit: y?.unit ?? null,
      profitPct: margin, vatPct: vat,
      notes: `Importada de la planilla de costos (hoja «${sheet}»).`,
      lines, planillaUnitCost: r.unitCost, systemUnitCost: null, incomplete,
    });
  }

  // 8. Costo con las reglas del sistema, para comparar con la planilla
  const bySheet = new Map(recipes.map(r => [r.sheet, r]));
  const totals = new Map<string, number | null>();
  const totalOf = (sheet: string): number | null => {
    if (totals.has(sheet)) return totals.get(sheet)!;
    totals.set(sheet, null); // corta ciclos
    const r = bySheet.get(sheet);
    if (!r) return null;
    let sum = 0;
    for (const l of r.lines) {
      if (l.kind === 'item') {
        const c = cands.get(l.key)!;
        if (c.costPerUnit === null) continue;
        const eq = c.equivalence ? { itemUnit: c.unit, eq: c.equivalence } : null;
        sum += c.costPerUnit * convertUnits(l.quantity, l.unit, c.unit, eq);
      } else {
        const sub = bySheet.get(l.sheet);
        const t = totalOf(l.sheet);
        if (!sub || t === null) continue;
        sum += l.unit === 'porcion'
          ? (t / sub.yield) * l.quantity
          : (t / sub.yieldQty!) * convertUnits(l.quantity, l.unit, sub.yieldUnit!);
      }
    }
    totals.set(sheet, sum);
    return sum;
  };
  for (const r of recipes) {
    const t = totalOf(r.sheet);
    r.systemUnitCost = t !== null ? t / r.yield : null;
  }

  const items: PlannedItem[] = [...cands.values()].map(c => ({
    key: c.key, name: c.name, category: c.category, unit: c.unit,
    presentation: c.presentation, costPerUnit: c.costPerUnit, equivalence: c.equivalence,
    areaName: c.areaName, countOrder: c.countOrder, origins: c.origins, usedIn: c.usedIn,
  }));
  items.sort((a, b) =>
    (a.areaName ? areas.indexOf(a.areaName) : 99) - (b.areaName ? areas.indexOf(b.areaName) : 99)
    || (a.countOrder ?? 0) - (b.countOrder ?? 0)
    || a.name.localeCompare(b.name, 'es'));

  const severityOrder: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.code.localeCompare(b.code));
  return { items, recipes, stock, areas, issues };
}
