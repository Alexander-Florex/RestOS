// ──────────────────────────────────────────────
// planillas/normalize.ts — Nombres y presentaciones de las planillas del cliente
// (tarea 2.9). Sin base de datos ni Excel: funciones puras, fáciles de testear.
// ──────────────────────────────────────────────
import { normalizeUnit, unitFamily, type Unit, type UnitFamily } from '../../shared/units.js';

const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'y', 'p', 'c', 'x', 'para', 'a']);

/** Singular simple: "limones" → "limon", "tomates" → "tomate", "huevos" → "huevo". */
function singular(word: string): string {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (/[lnr]es$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Palabras de un nombre: minúsculas, sin tildes, sin signos, en singular. */
export function nameTokens(raw: string): string[] {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
}

/** Clave para unir nombres: "Huevos " y "huevo" → "huevo"; "Ñoquis de papa" → "noqui de papa". */
export function nameKey(raw: string): string {
  return nameTokens(raw).join(' ');
}

/** Palabras significativas (sin "de", "la", "x"...), para comparar nombres parecidos. */
export function contentTokens(raw: string): string[] {
  return nameTokens(raw).filter(t => !STOPWORDS.has(t));
}

/** true si todas las palabras de `a` están en `b`. */
export function tokensWithin(a: string[], b: string[]): boolean {
  const set = new Set(b);
  return a.length > 0 && a.every(t => set.has(t));
}

/** Parecido entre dos nombres (0–1): palabras en común sobre el total. */
export function similarity(a: string, b: string): number {
  const ta = new Set(contentTokens(a));
  const tb = new Set(contentTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / new Set([...ta, ...tb]).size;
}

/** Nombre prolijo para mostrar: sin espacios de más. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export interface Qty {
  qty: number;
  unit: Unit;
}

/** "1.234,5" o "2,5" → número; null si no es un número. */
export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+([.,]\d+)*$/.test(t)) return null;
  // "1.234,5" → miles con punto y decimales con coma; "2,5" → decimal con coma; "2.5" → decimal con punto
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Presentación escrita a mano: "x 1kg", "25 kilos", "5 litros", "x 1000cc",
 * "x500g", "12 un.", "Maple" (30 un), "kilo", "litro", "unidad", "2,5 kilos (pack)".
 * null si no se entiende ("12 atados", "L", "Precio").
 */
export function parsePresentationText(raw: string | null | undefined): Qty | null {
  if (!raw) return null;
  const text = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (/^maples?$/.test(text)) return { qty: 30, unit: 'un' };
  const m = text.match(/^(?:x\s*)?(\d+(?:[.,]\d+)?)?\s*([a-z]+\.?)/);
  if (!m) return null;
  const word = m[2].replace(/\.$/, '');
  if (word === 'maple' || word === 'maples') return { qty: 30 * (m[1] ? parseNumber(m[1]) ?? 1 : 1), unit: 'un' };
  const unit = normalizeUnit(word);
  // "L" suelto es ambiguo en la planilla (aparece en Maicena): no se adivina
  if (!unit || (word === 'l' && !m[1])) return null;
  const qty = m[1] ? parseNumber(m[1]) : 1;
  return qty && qty > 0 ? { qty, unit } : null;
}

/**
 * Rendimiento escrito en la celda C8: "1 litro ", "1 litro (aprox. 4 frascos)", "500 grs".
 * Devuelve null para porciones ("20 porciones", 4): eso va en el rendimiento en porciones.
 */
export function parseYieldText(raw: unknown): Qty | null {
  if (typeof raw !== 'string') return null;
  if (/porci/i.test(raw)) return null;
  const q = parsePresentationText(raw.replace(/\(.*\)/, ''));
  return q && unitFamily(q.unit) !== 'count' ? q : null;
}

/** Unidad base para guardar un insumo según la familia: kg, l o un. */
export function baseUnit(family: UnitFamily): Unit {
  return family === 'mass' ? 'kg' : family === 'volume' ? 'l' : 'un';
}

/** Unidad de una línea de receta de la planilla ("Grs", "CC", "Un.", "UNIDAD", "ud", "Porcion"). */
export function lineUnit(raw: unknown): Unit | 'porcion' | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (/^porci/i.test(raw.trim())) return 'porcion';
  return normalizeUnit(raw);
}
