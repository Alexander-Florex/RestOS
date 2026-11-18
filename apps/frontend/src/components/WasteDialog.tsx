// ──────────────────────────────────────────────
// WasteDialog.tsx — Registrar una merma (tarea 3.7): vencido, roto, error de cocina…
// Descuenta del stock con motivo (movimiento WASTE).
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { stockApi, ApiError, type InventoryItem } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const REASONS = ['Vencido', 'Se rompió / se cayó', 'Error de cocina', 'Mal estado'];

export function WasteDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (item) { setQty(''); setReason(''); } }, [item]);
  if (!item) return null;

  async function save() {
    const q = Number(qty.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) { toast.error('Poné cuánto se tiró'); return; }
    if (reason.trim().length < 3) { toast.error('Elegí o escribí el motivo'); return; }
    setSaving(true);
    try {
      await stockApi.waste(item!.id, q, reason.trim());
      toast.success(`Merma de ${q} ${item!.unit} de ${item!.name} registrada`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo registrar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merma de {item.name}</DialogTitle>
          <DialogDescription>Lo que se tira o se pierde. Se descuenta del stock y queda con el motivo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wQty">Cantidad ({item.unit}) *</Label>
            <Input id="wQty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={saving} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wReason">Motivo *</Label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map(r => (
                <button key={r} type="button" onClick={() => setReason(r)} disabled={saving}
                  className={`rounded-lg border px-2 py-1 text-xs ${reason === r ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-border text-muted-foreground'}`}>
                  {r}
                </button>
              ))}
            </div>
            <Input id="wReason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} placeholder="U otro motivo" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Registrar merma</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
