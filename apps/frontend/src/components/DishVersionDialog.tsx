// ──────────────────────────────────────────────
// DishVersionDialog.tsx — Elegir la versión de un plato al tomar el pedido
// Botones grandes para el celular del mozo.
// ──────────────────────────────────────────────
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import type { MenuItem } from '../lib/api';
import type { PendingVersion } from '../hooks/useDishVersions';
import { formatMoney } from '../lib/format';

export function DishVersionDialog({ pending, onClose }: { pending: PendingVersion | null; onClose: () => void }) {
  function pick(item: MenuItem) {
    const onPick = pending?.onPick;
    onClose();
    onPick?.(item);
  }

  return (
    <Dialog open={!!pending} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{pending?.item.name}</DialogTitle>
          <DialogDescription>¿Qué versión pidió el cliente?</DialogDescription>
        </DialogHeader>
        {pending && (
          <div className="space-y-2">
            {[pending.item, pending.large].map(version => (
              <button key={version.id} type="button" onClick={() => pick(version)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.03] px-4 py-3 text-left transition-colors hover:border-brand-400/50 hover:bg-brand-500/10 active:scale-[0.98]">
                <span className="min-w-0">
                  <span className="block text-base font-semibold">{version.category}</span>
                  <span className="block truncate text-xs text-muted-foreground">{version.name}</span>
                </span>
                <span className="shrink-0 font-display text-base font-bold tabular-nums text-brand-300">
                  {formatMoney(version.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
