// ──────────────────────────────────────────────
// planillas-fixture.ts — Planillas de prueba armadas en memoria (tarea 2.9)
// Mismo diseño que las del cliente (que no pueden ir al repo), con sus errores
// típicos a propósito: sub-receta tomada por precio con IVA, harina calculada
// por kilo cuando el precio es de la bolsa de 25 kg, "Lomo" apuntando a la fila
// de "Bife angosto", porciones 0,3 y un nombre copiado de otra receta.
// ──────────────────────────────────────────────
import ExcelJS from 'exceljs';

type Line = [name: string | null, cost: number | { formula: string; result: number } | null, presQty: number | null, presUnit: string | null, qty: number | null, unit: string | null];

function recipeSheet(wb: ExcelJS.Workbook, sheet: string, o: {
  title: string | null; yieldText?: string | number | null; portions: number; unitCost: number; margin: number; lines: Line[];
}) {
  const ws = wb.addWorksheet(sheet);
  ws.getCell('C7').value = o.title;
  ws.getCell('C8').value = o.yieldText ?? o.portions;
  ws.getCell('H8').value = { formula: 'H18', result: o.unitCost * o.portions };
  ws.getCell('H9').value = o.portions;
  ws.getCell('H10').value = { formula: 'H8/H9', result: o.unitCost };
  ws.getCell('H11').value = o.margin;
  ws.getCell('H12').value = { formula: 'H10/(1-H11)', result: o.unitCost / (1 - o.margin) };
  ws.getCell('H13').value = 0.21;
  ws.getCell('H14').value = { formula: 'H12*(1+H13)', result: (o.unitCost / (1 - o.margin)) * 1.21 };
  ws.getCell('H18').value = { formula: 'SUM(H21:H47)', result: o.unitCost * o.portions };
  o.lines.forEach((l, i) => {
    const r = 21 + i;
    ws.getCell(`B${r}`).value = l[0];
    ws.getCell(`C${r}`).value = l[1];
    ws.getCell(`D${r}`).value = l[2];
    ws.getCell(`E${r}`).value = l[3];
    ws.getCell(`F${r}`).value = l[4];
    ws.getCell(`G${r}`).value = l[5];
  });
}

export function buildFixture(): { costs: ExcelJS.Workbook; stock: ExcelJS.Workbook } {
  const costs = new ExcelJS.Workbook();
  costs.addWorksheet('Hoja1').addRows([['Harina 0000', 800], ['Leche ', 2200]]);

  const ins = costs.addWorksheet('Insumos');
  const set = (r: number, b: string, d: unknown, e?: unknown, f?: unknown) => {
    ins.getCell(`B${r}`).value = b;
    if (d !== undefined) ins.getCell(`D${r}`).value = d as ExcelJS.CellValue;
    if (e !== undefined) ins.getCell(`E${r}`).value = e as ExcelJS.CellValue;
    if (f !== undefined) ins.getCell(`F${r}`).value = f as ExcelJS.CellValue;
  };
  set(3, 'INSUMOS', 'Precio', 'Precio unitario');
  set(5, 'Harina 0000', 25000, { formula: '+D5/25', result: 1000 }, '25 kilos');
  set(6, 'Huevos ', 6600, { formula: '+D6/30', result: 220 }, 'Maple');
  set(7, 'Vinagre', 3000, 'x 1000cc');
  set(8, 'LACTEOS', null);
  set(9, 'Leche ', 2200);
  set(10, 'CARNES', null);
  set(11, 'Bife angosto', 24500);
  set(12, 'Lomo', 25000);

  recipeSheet(costs, 'Chimichurri', {
    title: 'Chimichurri', yieldText: '1 litro ', portions: 1, unitCost: 1500, margin: 0.74,
    lines: [['Vinagre', { formula: '+Insumos!D7', result: 3000 }, 1000, 'CC', 500, 'CC']],
  });
  recipeSheet(costs, 'Lomo Wellington', {
    title: 'Lomo Wellington', portions: 1, unitCost: 12000, margin: 0.48,
    lines: [
      ['Lomo', { formula: '+Insumos!D11', result: 24500 }, 1000, 'Grs', 400, 'Grs'],
      // Error de la planilla: toma el precio con IVA del chimichurri
      ['Chimichurri', { formula: '+Chimichurri!H14', result: 7000 }, 1000, 'CC', 50, 'CC'],
      ['Huevos', { formula: '+Insumos!E6', result: 220 }, 1, 'Un.', 2, 'Un.'],
      // Error de la planilla: $25.000 de la bolsa de 25 kg tomado como precio por kilo
      ['Harina', { formula: '+Insumos!D5', result: 25000 }, 1000, 'Grs', 100, 'Grs'],
      [null, null, 1000, 'Grs', 150, 'Grs'],
    ],
  });
  recipeSheet(costs, 'Empanadas carne', {
    title: 'Empanadas carne', portions: 0.3, unitCost: 3000, margin: 0.67,
    lines: [['Bife angosto', { formula: '+Insumos!D11', result: 24500 }, 1000, 'Grs', 30, 'Grs']],
  });
  recipeSheet(costs, 'Pez gallo', {
    title: 'Salmon', portions: 1, unitCost: 2000, margin: 0.48,
    lines: [['Leche', { formula: '+Insumos!D9', result: 2200 }, 1000, 'CC', 100, 'CC']],
  });
  costs.addWorksheet('Modelo');

  const stock = new ExcelJS.Workbook();
  stock.addWorksheet('Hoja1').addRows([
    ['CARNES/PESCADOS/MARISCOS'], ['Bife de chorizo'], ['Lomo'],
    ['ESTANTERIAS DEPOSITO'], ['Harina 0000'], ['Huevos Maple'], ['Vinagre'],
    ['ART LIMPIEZA/DESCARTABLES'], ['lavandina'],
  ]);
  return { costs, stock };
}
