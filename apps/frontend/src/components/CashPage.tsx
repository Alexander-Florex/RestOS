// ──────────────────────────────────────────────
// CashPage.tsx — Caja (tarea 5.1, permiso "Abrir y cerrar caja")
//
// Una sola caja por local: se abre con el monto inicial, se anotan ingresos y
// egresos de efectivo y se cierra contando la plata. Muestra en vivo lo cobrado
// por medio de pago, lo dejado a cuenta y el efectivo que debería haber.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownCircle, ArrowUpCircle, Loader2, Lock, LockOpen, Wallet } from 'lucide-react';
import { cashApi, ApiError, type CashCurrent, type CashHistoryRow, type CashSummary } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { formatMoney, formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
/** "20.000" o "20000" → 20000; "1.500,50" o "1500.50" → 1500.5 */
function parseMoney(raw: string): number {
  const s = raw.trim().replace(/\s|\$/g, '');
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

export function CashPage() {
  const [cur, setCur] = useState<CashCurrent | null>(null);
  const [history, setHistory] = useState<CashHistoryRow[]>([]);
  const [movement, setMovement] = useState<'IN' | 'OUT' | null>(null);
  const [closing, setClosing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([cashApi.current(), cashApi.history()]);
      setCur(c);
      setHistory(h.sessions);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar la caja');
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useResync(refresh);
  useEffect(() => {
    const socket = getSocket();
    const on = () => { refresh(); };
    socket.on(SocketEvents.CASH_CHANGED, on);
    socket.on(SocketEvents.SALE_REGISTERED, on);
    socket.on(SocketEvents.ACCOUNTS_CHANGED, on);
    return () => {
      socket.off(SocketEvents.CASH_CHANGED, on);
      socket.off(SocketEvents.SALE_REGISTERED, on);
      socket.off(SocketEvents.ACCOUNTS_CHANGED, on);
    };
  }, [refresh]);

  if (!cur) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Caja</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Caja</h2>
        <p className="text-sm text-muted-foreground">
          {cur.open
            ? `Abierta a las ${timeFmt.format(new Date(cur.open.openedAt))}${cur.open.openedBy ? ` por ${cur.open.openedBy}` : ''} con ${formatMoney(cur.open.openingAmount)}.`
            : 'La caja está cerrada.'}
        </p>
      </div>

      {cur.open ? (
        <>
          <Summary s={cur.open.summary} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMovement('IN')}><ArrowDownCircle className="h-4 w-4" /> Ingreso de efectivo</Button>
            <Button variant="outline" onClick={() => setMovement('OUT')}><ArrowUpCircle className="h-4 w-4" /> Egreso de efectivo</Button>
            <Button onClick={() => setClosing(true)}><Lock className="h-4 w-4" /> Cerrar caja</Button>
          </div>
        </>
      ) : (
        <OpenForm cur={cur} onDone={refresh} />
      )}

      {history.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Cierres anteriores</h3>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Cierre</th>
                  <th className="px-3 py-2 text-right font-medium">Cobrado</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Esperado</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Contado</th>
                  <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="px-3 py-2">
                      {formatDateTime(h.closedAt)}
                      <span className="block text-xs text-muted-foreground">{h.closedBy ?? ''}{h.closeNotes ? ` · ${h.closeNotes}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(h.summary?.totalCollected ?? 0)}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{formatMoney(h.expectedCash)}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{formatMoney(h.countedCash)}</td>
                    <td className={cn('px-3 py-2 text-right font-semibold tabular-nums',
                      h.difference < 0 ? 'text-rose-300' : h.difference > 0 ? 'text-amber-300' : 'text-emerald-300')}>
                      {h.difference > 0 ? '+' : ''}{formatMoney(h.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {movement && <MovementDialog type={movement} onClose={() => setMovement(null)} onDone={() => { setMovement(null); refresh(); }} />}
      {closing && cur.open && (
        <CloseDialog summary={cur.open.summary} onClose={() => setClosing(false)} onDone={() => { setClosing(false); refresh(); }} />
      )}
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', accent)}>{formatMoney(value)}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Summary({ s }: { s: CashSummary }) {
  const n = (c: number) => `${c} ${c === 1 ? 'venta' : 'ventas'}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Efectivo que debería haber" value={s.expectedCash} accent="text-emerald-300"
          sub={`Inicial ${formatMoney(s.openingAmount)} + efectivo cobrado + ingresos − egresos`} />
        <Tile label="Total cobrado" value={s.totalCollected} sub="Todos los medios de pago" />
        <Tile label="Vendido" value={s.totalSales} sub={s.cancelledOrders ? `${s.cancelledOrders} pedidos anulados` : undefined} />
        <Tile label="A cuenta (sin cobrar)" value={s.onAccount.amount} sub={n(s.onAccount.count)} accent={s.onAccount.amount ? 'text-amber-300' : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Efectivo" value={s.sales.CASH.amount + s.accountPayments.CASH.amount} sub={n(s.sales.CASH.count)} />
        <Tile label="Tarjeta" value={s.sales.CARD.amount + s.accountPayments.CARD.amount} sub={n(s.sales.CARD.count)} />
        <Tile label="Transferencia" value={s.sales.TRANSFER.amount + s.accountPayments.TRANSFER.amount} sub={n(s.sales.TRANSFER.count)} />
      </div>
      {(s.accountPayments.CASH.count + s.accountPayments.CARD.count + s.accountPayments.TRANSFER.count) > 0 && (
        <p className="text-xs text-muted-foreground">
          Incluye cobros de cuenta corriente: {formatMoney(s.accountPayments.CASH.amount + s.accountPayments.CARD.amount + s.accountPayments.TRANSFER.amount)}.
        </p>
      )}
      {s.salesBeforeOpening > 0 && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {s.salesBeforeOpening} {s.salesBeforeOpening === 1 ? 'cobro se hizo' : 'cobros se hicieron'} con la caja cerrada: están sumados en esta caja.
        </p>
      )}
      {s.movements.list.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Ingresos y egresos</h3>
          <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
            {s.movements.list.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{timeFmt.format(new Date(m.createdAt))}</span> · {m.reason}
                  {m.by && <span className="text-muted-foreground"> · {m.by}</span>}
                </span>
                <span className={cn('font-semibold tabular-nums', m.type === 'IN' ? 'text-emerald-300' : 'text-rose-300')}>
                  {m.type === 'IN' ? '+' : '−'}{formatMoney(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OpenForm({ cur, onDone }: { cur: CashCurrent; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  async function open() {
    const v = parseMoney(amount || '0');
    if (!Number.isFinite(v) || v < 0) { toast.error('Poné el monto inicial (puede ser 0)'); return; }
    setSaving(true);
    try {
      await cashApi.open(v);
      toast.success(`Caja abierta con ${formatMoney(v)}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo abrir la caja');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="glass max-w-md space-y-4 rounded-3xl p-5">
      {cur.salesSinceLastClose && cur.salesSinceLastClose.count > 0 && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Desde el último cierre se cobraron {cur.salesSinceLastClose.count} {cur.salesSinceLastClose.count === 1 ? 'cuenta' : 'cuentas'} ({formatMoney(cur.salesSinceLastClose.total)}) con la caja cerrada. Van a sumarse a la caja que abras.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="opening">Efectivo con el que arranca la caja</Label>
        <Input id="opening" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ej.: 20000" disabled={saving} />
      </div>
      <Button onClick={open} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
        Abrir caja
      </Button>
    </div>
  );
}

function MovementDialog({ type, onClose, onDone }: { type: 'IN' | 'OUT'; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    const v = parseMoney(amount);
    if (!Number.isFinite(v) || v <= 0) { toast.error('Poné un monto mayor a cero'); return; }
    if (reason.trim().length < 3) { toast.error('Escribí el motivo'); return; }
    setSaving(true);
    try {
      await cashApi.movement({ type, amount: v, reason: reason.trim() });
      toast.success(type === 'IN' ? 'Ingreso registrado' : 'Egreso registrado');
      onDone();
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
          <DialogTitle>{type === 'IN' ? 'Ingreso de efectivo' : 'Egreso de efectivo'}</DialogTitle>
          <DialogDescription>
            {type === 'IN' ? 'Plata que entra a la caja y no es una venta (por ejemplo, cambio que trajeron).' : 'Plata que sale de la caja (por ejemplo, pago a un proveedor).'} Queda en Auditoría.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mvAmount">Monto *</Label>
            <Input id="mvAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mvReason">Motivo *</Label>
            <Input id="mvReason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving}
              placeholder={type === 'IN' ? 'Ej.: cambio del banco' : 'Ej.: pago a la verdulería'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ summary, onClose, onDone }: { summary: CashSummary; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const v = parseMoney(counted);
  const valid = counted.trim() !== '' && Number.isFinite(v) && v >= 0;
  const diff = valid ? Math.round((v - summary.expectedCash) * 100) / 100 : 0;
  async function save() {
    if (!valid) { toast.error('Contá el efectivo y poné el total'); return; }
    if (diff !== 0 && notes.trim().length < 3) { toast.error('Hay diferencia: escribí una aclaración'); return; }
    setSaving(true);
    try {
      await cashApi.close({ countedCash: v, notes: notes.trim() || null });
      toast.success(diff === 0 ? 'Caja cerrada sin diferencias' : `Caja cerrada con diferencia de ${formatMoney(diff)}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cerrar la caja');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(x) => !x && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-brand-400" /> Cerrar caja</DialogTitle>
          <DialogDescription>Contá el efectivo del cajón y poné el total. La diferencia queda registrada.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between rounded-2xl border border-border p-3 text-sm">
            <span>Efectivo que debería haber</span>
            <span className="font-semibold tabular-nums">{formatMoney(summary.expectedCash)}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="counted">Efectivo contado *</Label>
            <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} disabled={saving} autoFocus />
          </div>
          {valid && (
            <p className={cn('text-sm font-medium', diff < 0 ? 'text-rose-300' : diff > 0 ? 'text-amber-300' : 'text-emerald-300')}>
              {diff === 0 ? 'Sin diferencia' : diff < 0 ? `Faltan ${formatMoney(-diff)}` : `Sobran ${formatMoney(diff)}`}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="cnotes">Aclaración {diff !== 0 && '*'}</Label>
            <Input id="cnotes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} placeholder="Ej.: se dio mal un vuelto" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Volver</Button>
          <Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Cerrar caja</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
