// ──────────────────────────────────────────────
// cart-lines.ts — Ponerle nota u opciones a un plato que ya está en el carrito
//
// Las unidades pasan de una línea a la otra: no se suma un plato nuevo. Con 2 cargados
// y una nota para 1, quedan 1 sin nota y 1 con nota. Solo si piden más de los que
// había, la diferencia son platos nuevos. Sin dependencias (lo prueba el backend).
// ──────────────────────────────────────────────
export function moveToLine<L extends { key: string; quantity: number }>(
  lines: ReadonlyMap<string, L>,
  sourceKey: string,
  target: L,
): Map<string, L> {
  const next = new Map(lines);
  const source = next.get(sourceKey);
  if (source) {
    const moved = Math.min(source.quantity, target.quantity);
    if (moved === source.quantity) next.delete(sourceKey);
    else next.set(sourceKey, { ...source, quantity: source.quantity - moved });
  }
  const existing = next.get(target.key);
  next.set(target.key, existing ? { ...existing, quantity: existing.quantity + target.quantity } : target);
  return next;
}
