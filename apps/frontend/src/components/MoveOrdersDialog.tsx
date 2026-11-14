// ──────────────────────────────────────────────
// MoveOrdersDialog.tsx — Mover pedidos a otra mesa (tarea 5.3)
// Toda la mesa (se cambiaron de lugar: la vieja queda libre) o un pedido
// cargado en la mesa equivocada. Si la de destino está libre, se abre.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { tablesApi, ApiError, type Table, type Order } from '../lib/api';
import { TABLE_STATUS_LABEL } from '../lib/table-helpers';
import { tableLabel } from '../lib/table-label';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

export function MoveOrdersDialog({ table, allTables, order, open, onClose, onMoved }: {
  table: Table;
  allTables: Table[];
  /** Un pedido puntual; sin esto se muda toda la mesa */
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setTarget(null); }, [open]);

  const candidates = useMemo(() => allTables
    .filter(t => t.enabled && t.id !== table.id && t.status !== 'RESERVED')
    .sort((a, b) => a.number - b.number), [allTables, table.id]);

  async function move() {
    if (!target) { toast.error('Elegí la mesa de destino'); return; }
    setSaving(true);
    try {
      await tablesApi.moveOrders(table.id, target, order ? [order.id] : undefined);
      const dest = allTables.find(t => t.id === target)!;
      toast.success(order ? `Pedido #${order.id} movido a ${tableLabel(dest)}` : `${tableLabel(table)} se mudó a ${tableLabel(dest)}`);
      onMoved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo mover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{order ? `Mover el pedido #${order.id}` : `Mudar ${tableLabel(table)} a otra mesa`}</DialogTitle>
          <DialogDescription>
            {order
              ? 'Para un pedido que se cargó en la mesa equivocada. El resto sigue en esta mesa.'
              : 'Pasan todos los pedidos y los comensales; esta mesa queda libre.'} Si la de destino está libre, se abre.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No hay otras mesas disponibles.</p>
        ) : (
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {candidates.map(t => (
              <button key={t.id} type="button" disabled={saving} aria-pressed={target === t.id} onClick={() => setTarget(t.id)}
                className={cn('rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors',
                  target === t.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-200' : 'border-border hover:border-brand-500/30')}>
                <span className="block truncate font-semibold">{tableLabel(t)}</span>
                <span className="block text-xs text-muted-foreground">{TABLE_STATUS_LABEL[t.status]}</span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={move} disabled={saving || !target}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
