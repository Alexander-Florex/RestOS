// ──────────────────────────────────────────────
// JoinTablesDialog.tsx — Unir una mesa con otras (tarea 5.3)
// Se eligen una o más mesas; las libres se abren. Cada mesa conserva sus pedidos.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link2, Loader2 } from 'lucide-react';
import { tablesApi, ApiError, type Table } from '../lib/api';
import { TABLE_STATUS_LABEL } from '../lib/table-helpers';
import { tableLabel, tablesLabel } from '../lib/table-label';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

/** Mesas del mismo grupo (solo cuenta como unida si son dos o más). */
export function groupOf(table: Table, all: Table[]): Table[] {
  if (table.groupId === null) return [];
  const members = all.filter(t => t.groupId === table.groupId);
  return members.length >= 2 ? members : [];
}

export function JoinTablesDialog({ table, allTables, open, onClose }: {
  table: Table; allTables: Table[]; open: boolean; onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setSelected(new Set()); }, [open]);

  const current = groupOf(table, allTables);
  const candidates = useMemo(() => allTables
    .filter(t => t.enabled && t.id !== table.id && t.status !== 'RESERVED')
    .filter(t => !current.some(c => c.id === t.id))
    // Las que ya están unidas a otro grupo no se ofrecen (primero hay que separarlas)
    .filter(t => groupOf(t, allTables).length === 0)
    .sort((a, b) => a.number - b.number), [allTables, table.id, current]);

  async function join() {
    if (selected.size === 0) { toast.error('Elegí al menos una mesa'); return; }
    setSaving(true);
    try {
      const { tables } = await tablesApi.join(table.id, [...selected]);
      toast.success(`Unidas: ${tablesLabel(tables)}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron unir las mesas');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unir {tableLabel(table)} con…</DialogTitle>
          <DialogDescription>
            Cada mesa conserva sus pedidos. La cuenta se ve junta y se puede cobrar todo junto o cada mesa por separado.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No hay otras mesas disponibles para unir.</p>
        ) : (
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {candidates.map(t => {
              const on = selected.has(t.id);
              return (
                <button key={t.id} type="button" disabled={saving} aria-pressed={on}
                  onClick={() => setSelected(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                  className={cn('rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors',
                    on ? 'border-brand-500/60 bg-brand-500/10 text-brand-200' : 'border-border hover:border-brand-500/30')}>
                  <span className="block truncate font-semibold">{tableLabel(t)}</span>
                  <span className="block text-xs text-muted-foreground">{TABLE_STATUS_LABEL[t.status]}</span>
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={join} disabled={saving || selected.size === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Unir {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
