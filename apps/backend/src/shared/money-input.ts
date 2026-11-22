// ──────────────────────────────────────────────
// money-input.ts — Lee un monto escrito a mano, en formato argentino
//
// "5.000" son cinco mil (no cinco) y "5.000,50" son 5000,50. También acepta "5000",
// "5000,5" y "5000.50". Lo que no se entiende da NaN: mejor rechazar que cobrar mal.
// Sin dependencias: lo comparten backend y frontend (@shared).
// ──────────────────────────────────────────────
export function parseMoneyInput(raw: string): number {
  const s = raw.trim().replace(/^\$\s*/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+([.,]\d{1,2})?$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}
