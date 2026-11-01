// ──────────────────────────────────────────────
// ItemModifiers.tsx — Opciones y nota de un plato pedido
// "SIN croutones" en rojo, "Término: a punto" y "+ Extra queso" normales,
// la nota del mozo en ámbar. Igual en carrito, mesa y para llevar.
// ──────────────────────────────────────────────
import type { ItemModifier } from '../lib/api';
import { cn } from '../lib/utils';

export function ItemModifiers({ modifiers, notes, className }: {
  modifiers?: ItemModifier[] | null;
  notes?: string | null;
  className?: string;
}) {
  const mods = modifiers ?? [];
  const note = notes?.trim();
  if (mods.length === 0 && !note) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {mods.map(m => (
        <span key={`${m.groupId}-${m.optionId}`} className={cn(
          'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
          m.kind === 'REMOVE' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/[0.06] text-foreground/80',
        )}>
          {m.kind === 'REMOVE' ? `SIN ${m.option}` : m.kind === 'SINGLE' ? `${m.group}: ${m.option}` : `+ ${m.option}`}
        </span>
      ))}
      {note && (
        <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200">📝 {note}</span>
      )}
    </div>
  );
}
