// ──────────────────────────────────────────────
// StorageAreasDialog.tsx — Sectores de guardado (tarea 3.1)
// Agregar, renombrar, ordenar (el orden es el del conteo) y borrar.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useConfirm } from './ui/confirm-dialog';
import { ApiError, storageAreasApi, type StorageArea } from '../lib/api';

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function StorageAreasDialog({ open, onClose, areas }: { open: boolean; onClose: () => void; areas: StorageArea[] }) {
  const confirm = useConfirm();
  const [names, setNames] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNames(Object.fromEntries(areas.map(a => [a.id, a.name])));
  }, [areas]);

  async function rename(area: StorageArea) {
    const name = (names[area.id] ?? '').trim();
    if (!name || name === area.name) { setNames(n => ({ ...n, [area.id]: area.name })); return; }
    try {
      await storageAreasApi.update(area.id, { name });
      toast.success('Sector renombrado');
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo renombrar'));
      setNames(n => ({ ...n, [area.id]: area.name }));
    }
  }

  /** Intercambia el orden con el vecino (arriba o abajo). */
  async function move(idx: number, dir: -1 | 1) {
    const a = areas[idx];
    const b = areas[idx + dir];
    if (!a || !b) return;
    setBusy(true);
    try {
      // Si tenían el mismo número, se separan para que el cambio se note
      const aOrder = b.sortOrder === a.sortOrder ? a.sortOrder + dir : b.sortOrder;
      await storageAreasApi.update(a.id, { sortOrder: Math.max(0, aOrder) });
      await storageAreasApi.update(b.id, { sortOrder: a.sortOrder });
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo ordenar'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(area: StorageArea) {
    const ok = await confirm({
      title: `¿Borrar el sector "${area.name}"?`,
      description: area.itemCount > 0
        ? `Sus ${area.itemCount} insumos no se borran: quedan "sin sector".`
        : 'No tiene insumos.',
      variant: 'destructive', confirmLabel: 'Borrar',
    });
    if (!ok) return;
    try {
      await storageAreasApi.remove(area.id);
      toast.success('Sector borrado');
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo borrar'));
    }
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await storageAreasApi.create({ name });
      setNewName('');
      toast.success(`Sector "${name}" agregado`);
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo agregar'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sectores de guardado</DialogTitle>
          <DialogDescription>
            Dónde se guarda cada insumo. El orden de esta lista es el orden del conteo de stock.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {areas.map((area, idx) => (
            <li key={area.id} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => move(idx, -1)} disabled={busy || idx === 0} aria-label={`Subir ${area.name}`}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => move(idx, 1)} disabled={busy || idx === areas.length - 1} aria-label={`Bajar ${area.name}`}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input value={names[area.id] ?? ''} aria-label="Nombre del sector"
                onChange={(e) => setNames(n => ({ ...n, [area.id]: e.target.value }))}
                onBlur={() => rename(area)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {area.itemCount} {area.itemCount === 1 ? 'insumo' : 'insumos'}
              </span>
              <Button variant="ghost" size="icon" className="shrink-0 text-rose-400 hover:text-rose-300"
                onClick={() => remove(area)} aria-label={`Borrar ${area.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input value={newName} placeholder="Nuevo sector (ej. Freezer)" maxLength={100}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Button onClick={add} disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" /> Agregar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
