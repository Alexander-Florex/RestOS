// ──────────────────────────────────────────────
// planillas/report.ts — Informe del importador (tarea 2.9)
// import-report.md (para leer) + CSV (para filtrar en Excel).
// ──────────────────────────────────────────────
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Issue, Plan, Severity } from './plan.js';
import type { ApplyResult } from './apply.js';

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('es-AR')}`);
const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warn: 'Revisar', info: 'Aviso' };

const CODE_TITLE: Record<string, string> = {
  SUBRECETA_MAL_VINCULADA: 'Sub-recetas tomadas por precio o costo total',
  PRESENTACION_DISTINTA: 'Insumos que la planilla calculaba con otra presentación',
  VINCULO_A_OTRO_INSUMO: 'Líneas vinculadas al precio de otro insumo',
  NOMBRE_COPIADO: 'Recetas con el nombre copiado de otra',
  PORCIONES_INVALIDAS: 'Recetas sin porciones válidas',
  PRECIO_A_MANO: 'Precios escritos a mano',
  SIN_COSTO: 'Ingredientes sin costo',
  SIN_CANTIDAD: 'Ingredientes sin cantidad',
  FILA_SIN_INGREDIENTE: 'Filas con cantidad pero sin ingrediente',
  UNIDAD_INCOMPATIBLE: 'Unidades incompatibles',
  SIN_UNIDAD: 'Unidades no reconocidas',
  SIN_PRECIO: 'Insumos sin precio',
  SIN_PRESENTACION: 'Insumos con precio pero sin presentación',
  PRESENTACION_SUPUESTA: 'Presentaciones supuestas',
  PRESENTACION_TEXTO: 'Presentaciones con texto contradictorio',
  EQUIVALENCIA_SUPUESTA: 'Equivalencias peso/volumen supuestas',
  PRECIO_CONTRADICTORIO: 'Precios que no coinciden con Hoja1 o el concentrador',
  NOMBRE_DUPLICADO: 'Insumos repetidos',
  NOMBRE_DISTINTO: 'Líneas con nombre distinto al insumo vinculado',
  NOMBRE_VACIO: 'Recetas sin nombre en C7',
  MARGEN_BAJO: 'Márgenes bajos (menos de 50 %)',
  MARGEN_INVALIDO: 'Márgenes inválidos',
  IVA_DISTINTO: 'IVA distinto de 21 %',
  STOCK_PARECIDO: 'Ítems de stock unidos por nombre parecido',
  STOCK_AMBIGUO: 'Ítems de stock que se parecen a varios insumos',
  STOCK_NUEVO: 'Ítems de stock sin insumo en la planilla de costos',
  SUBRECETA_POR_PORCION: 'Sub-recetas usadas por porción',
  SUBRECETA_PESO_VOLUMEN: 'Sub-recetas que rinden en volumen y se usan en peso',
  POR_PLATO: 'Líneas que la planilla suma por plato',
  CONTADA_DOS_VECES: 'Líneas que la planilla sumaba dos veces',
  FUERA_DE_LA_SUMA: 'Líneas que la planilla no sumaba en el total',
  VINCULO_ROTO: 'Vínculos rotos',
  CICLO: 'Recetas que se usan a sí mismas',
  RECETA_VACIA: 'Recetas sin líneas válidas',
  APLICAR: 'Errores al importar',
};

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** CSV con ";" (Excel en español lo abre en columnas) y BOM para las tildes. */
function csv(rows: unknown[][]): string {
  return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function renderMarkdown(plan: Plan, opts: { mode: 'dry-run' | 'apply'; files: string[]; result?: ApplyResult }): string {
  const count = (s: Severity) => plan.issues.filter(i => i.severity === s).length;
  const priced = plan.items.filter(i => i.costPerUnit !== null).length;
  const out: string[] = [];
  out.push('# Informe de importación de planillas', '');
  out.push(`- Fecha: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`);
  out.push(`- Modo: **${opts.mode === 'apply' ? 'importación (--apply)' : 'prueba (--dry-run): no se escribió nada'}**`);
  for (const f of opts.files) out.push(`- Archivo: \`${f}\``);
  out.push('');
  out.push('## Resumen', '');
  out.push(`- Insumos: **${plan.items.length}** (${priced} con precio, ${plan.items.length - priced} sin precio)`);
  out.push(`- Ítems de la planilla de stock: **${plan.stock.length}** — ${plan.stock.filter(s => s.match === 'exact').length} unidos por nombre exacto, ${plan.stock.filter(s => s.match === 'approx').length} por nombre parecido, ${plan.stock.filter(s => s.match === 'new').length} nuevos`);
  out.push(`- Sectores: ${plan.areas.join(', ')}`);
  out.push(`- Recetas: **${plan.recipes.length}** (${plan.recipes.filter(r => r.incomplete).length} con líneas omitidas)`);
  out.push(`- Problemas: ${count('error')} errores, ${count('warn')} para revisar, ${count('info')} avisos`);
  if (opts.result) {
    const r = opts.result;
    out.push('', '### Lo que se escribió en la base', '');
    out.push(`- Restaurante #${r.restaurantId}`);
    out.push(`- Sectores creados: ${r.areasCreated}`);
    out.push(`- Insumos creados: ${r.itemsCreated} · ya existían: ${r.itemsExisting} (no se cambió su precio${r.itemsUpdated ? `; con --update se actualizaron ${r.itemsUpdated}` : ''}) · sector asignado a existentes: ${r.itemsAreaSet}`);
    out.push(`- Recetas creadas: ${r.recipesCreated} · ya existían: ${r.recipesExisting}${r.recipesUpdated ? ` · actualizadas: ${r.recipesUpdated}` : ''} · con error: ${r.recipesFailed.length}`);
    out.push(`- Recetas vinculadas a un plato de la carta: ${r.menuLinked.length ? r.menuLinked.join(', ') : 'ninguna (no hay platos con el mismo nombre)'}`);
    for (const f of r.recipesFailed) out.push(`  - ❌ «${f.name}»: ${f.error}`);
  }

  out.push('', '## Costos: planilla contra sistema', '');
  out.push('Costo por porción. La diferencia sale de corregir sub-recetas, presentaciones y vínculos (detalle abajo).', '');
  out.push('| Receta | Porciones | Margen | Planilla | Sistema | Diferencia |', '|---|---:|---:|---:|---:|---:|');
  for (const r of [...plan.recipes].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const diff = r.planillaUnitCost && r.systemUnitCost !== null ? (r.systemUnitCost - r.planillaUnitCost) / r.planillaUnitCost : null;
    const flag = diff !== null && Math.abs(diff) > 0.05 ? ' ⚠' : '';
    out.push(`| ${r.name}${r.incomplete ? ' *(incompleta)*' : ''} | ${r.yield} | ${Math.round(r.profitPct * 100)} % | ${money(r.planillaUnitCost)} | ${money(r.systemUnitCost)} | ${diff === null ? '—' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} %${flag}`} |`);
  }

  const groups = new Map<string, Issue[]>();
  for (const i of plan.issues) {
    if (!groups.has(i.code)) groups.set(i.code, []);
    groups.get(i.code)!.push(i);
  }
  out.push('', '## Problemas encontrados', '');
  out.push('Ordenados por gravedad. **Error**: no se pudo importar algo. **Revisar**: se importó con una decisión que conviene confirmar. **Aviso**: informativo.', '');
  for (const [code, list] of groups) {
    out.push(`### ${SEVERITY_LABEL[list[0].severity]} · ${CODE_TITLE[code] ?? code} (${list.length})`, '');
    for (const i of list) out.push(`- **${i.where}**: ${i.message}`);
    out.push('');
  }
  out.push('## Archivos', '', '- `problemas.csv`: todos los problemas, para filtrar.', '- `items.csv`: cada insumo con presentación, costo, sector y orden de conteo.', '- `recetas.csv`: cada receta con su costo en la planilla y en el sistema.', '');
  return out.join('\n');
}

export async function writeReport(dir: string, plan: Plan, opts: { mode: 'dry-run' | 'apply'; files: string[]; result?: ApplyResult }) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'import-report.md'), renderMarkdown(plan, opts), 'utf8');
  await writeFile(path.join(dir, 'problemas.csv'), csv([
    ['Gravedad', 'Tipo', 'Dónde', 'Detalle'],
    ...plan.issues.map(i => [SEVERITY_LABEL[i.severity], CODE_TITLE[i.code] ?? i.code, i.where, i.message]),
  ]), 'utf8');
  await writeFile(path.join(dir, 'items.csv'), csv([
    ['Insumo', 'Categoría', 'Unidad', 'Presentación', 'Precio presentación', 'Costo por unidad', 'Equivalencia', 'Sector', 'Orden conteo', 'Origen', 'Usado en'],
    ...plan.items.map(i => [
      i.name, i.category, i.unit,
      i.presentation ? `${i.presentation.qty} ${i.presentation.unit}` : '',
      i.presentation ? i.presentation.price : '',
      i.costPerUnit !== null ? Number(i.costPerUnit.toFixed(4)) : '',
      i.equivalence ? `1 ${i.unit} = ${i.equivalence.qty} ${i.equivalence.unit}` : '',
      i.areaName ?? '', i.countOrder ?? '', i.origins.join(' | '), i.usedIn.join(', '),
    ]),
  ]), 'utf8');
  await writeFile(path.join(dir, 'recetas.csv'), csv([
    ['Receta', 'Hoja', 'Porciones', 'Rinde', 'Margen', 'IVA', 'Costo porción planilla', 'Costo porción sistema', 'Líneas', 'Incompleta'],
    ...plan.recipes.map(r => [
      r.name, r.sheet, r.yield, r.yieldQty ? `${r.yieldQty} ${r.yieldUnit}` : '', r.profitPct, r.vatPct,
      r.planillaUnitCost !== null ? Math.round(r.planillaUnitCost) : '',
      r.systemUnitCost !== null ? Math.round(r.systemUnitCost) : '',
      r.lines.length, r.incomplete ? 'sí' : '',
    ]),
  ]), 'utf8');
}
