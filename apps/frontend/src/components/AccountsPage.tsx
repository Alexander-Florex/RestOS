// ──────────────────────────────────────────────
// AccountsPage.tsx — Cuentas corrientes (tarea 5.9, permiso accounts.manage)
//
// Clientes que comen y pagan después (Municipalidad, cooperativa eléctrica):
// cuánto debe cada uno, las comidas agrupadas por semana (facturan por semana)
// y el cobro con recargo, que se decide al cobrar (viene 20 %).
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Edit, Loader2, NotebookPen, Plus, Trash2, XCircle } from 'lucide-react';
import {
  accountsApi, ApiError, type AccountCustomer, type AccountStatement, type PaymentMethod,
} from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { formatMoney, formatDateTime } from '../lib/format';
import { PAYMENT_LABEL, PAYMENT_OPTIONS } from '../lib/menu-helpers';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { useConfirm } from './ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const dayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayLabel = (day: string) => dayFmt.format(new Date(`${day}T12:00:00Z`));
const DEFAULT_SURCHARGE = 20;

/** Recarga cuando cambia algo de cuentas o se deja una mesa a cuenta. */
function useLive(refresh: () => unknown) {
  useResync(refresh);
  useEffect(() => {
    const socket = getSocket();
    const on = () => { refresh(); };
    socket.on(SocketEvents.ACCOUNTS_CHANGED, on);
    socket.on(SocketEvents.SALE_REGISTERED, on);
    return () => {
      socket.off(SocketEvents.ACCOUNTS_CHANGED, on);
      socket.off(SocketEvents.SALE_REGISTERED, on);
    };
  }, [refresh]);
}

export function AccountsPage() {
  const [customers, setCustomers] = useState<AccountCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AccountCustomer | 'new' | null>(null);

  const refresh = useCallback(async () => {
    try { setCustomers((await accountsApi.list()).customers); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las cuentas'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useLive(refresh);

  const selected = customers.find(c => c.id === selectedId) ?? null;
  const totalDebt = customers.reduce((s, c) => s + c.balance, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Caja</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Cuentas corrientes</h2>
          <p className="text-sm text-muted-foreground">
            Comen, firman la comanda y pagan después. Se deben en total {formatMoney(totalDebt)}.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Nuevo cliente
        </Button>
      </div>

      {customers.length === 0 ? (
        <div className="glass rounded-3xl p-10 text-center text-sm text-muted-foreground">
          Todavía no hay clientes con cuenta corriente. Cargá, por ejemplo, la Municipalidad y la cooperativa eléctrica.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
              className={cn('glass rounded-2xl p-4 text-left transition-colors',
                c.id === selectedId ? 'border border-brand-500/50' : 'hover:border hover:border-white/15',
                !c.active && 'opacity-50')}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-brand-400" />
                  <span className="truncate font-semibold">{c.name}</span>
                </div>
                {!c.active && <span className="text-xs text-muted-foreground">inactivo</span>}
              </div>
              <p className={cn('mt-2 text-2xl font-bold tabular-nums', c.balance > 0 ? 'text-amber-300' : 'text-muted-foreground')}>
                {formatMoney(c.balance)}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.unpaidCount > 0
                  ? `${c.unpaidCount} ${c.unpaidCount === 1 ? 'comida' : 'comidas'} sin cobrar${c.oldestUnpaid ? ` · desde el ${formatDateTime(c.oldestUnpaid).split(',')[0]}` : ''}`
                  : 'Al día'}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && <Statement customer={selected} onEdit={() => setEditing(selected)} />}

      {editing && (
        <CustomerDialog customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onDeleted={() => { setSelectedId(null); setEditing(null); }} />
      )}
    </div>
  );
}

/** Estado de cuenta de un cliente: semanas impagas, cobro y cobros anteriores. */
function Statement({ customer, onEdit }: { customer: AccountCustomer; onEdit: () => void }) {
  const [st, setSt] = useState<AccountStatement | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState<AccountStatement['payments'][number] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await accountsApi.statement(customer.id);
      setSt(s);
      // Lo tildado que ya no se debe (otro lo cobró) se destilda
      const unpaid = new Set(s.weeks.flatMap(w => w.sales.map(x => x.id)));
      setChecked(prev => new Set([...prev].filter(id => unpaid.has(id))));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el estado de cuenta');
    }
  }, [customer.id]);
  useEffect(() => { setSt(null); setChecked(new Set()); refresh(); }, [refresh]);
  useLive(refresh);

  const allSales = useMemo(() => st?.weeks.flatMap(w => w.sales) ?? [], [st]);
  const selectedDebt = allSales.filter(s => checked.has(s.id)).reduce((n, s) => n + Math.round(s.total * 100), 0) / 100;
  const toggle = (ids: number[], on: boolean) => setChecked(prev => {
    const n = new Set(prev);
    ids.forEach(id => (on ? n.add(id) : n.delete(id)));
    return n;
  });

  if (!st) return <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <section className="glass space-y-5 rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{customer.name}</h3>
          <p className="text-xs text-muted-foreground">
            {[customer.cuit && `CUIT ${customer.cuit}`, customer.contact].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}><Edit className="h-3.5 w-3.5" /> Editar</Button>
      </div>

      {/* Lo que debe, por semana */}
      <div>
        <h4 className="mb-2 text-sm font-semibold">Sin cobrar ({formatMoney(st.balance)})</h4>
        {st.weeks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No debe nada.</p>
        ) : (
          <div className="space-y-3">
            {st.weeks.map(w => {
              const ids = w.sales.map(s => s.id);
              const all = ids.every(id => checked.has(id));
              return (
                <div key={w.weekStart} className="rounded-2xl border border-border">
                  <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-border bg-white/[0.03] px-3 py-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                      Semana del {dayLabel(w.weekStart)} al {dayLabel(w.weekEnd)}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(w.total)}</span>
                  </label>
                  <ul className="divide-y divide-border">
                    {w.sales.map(s => (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <input type="checkbox" checked={checked.has(s.id)} onChange={(e) => toggle([s.id], e.target.checked)} />
                            <span className="text-muted-foreground">{formatDateTime(s.closedAt)}</span>
                            <span className="truncate">{s.table ?? ''}{s.notes ? ` · ${s.notes}` : ''}</span>
                          </span>
                          <span className="tabular-nums">{formatMoney(s.total)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {checked.size > 0 ? `Elegidas: ${checked.size} · ${formatMoney(selectedDebt)}` : 'Tildá la semana (o las comidas) que pagan.'}
              </span>
              <Button disabled={checked.size === 0} onClick={() => setPaying(true)}>
                <NotebookPen className="h-4 w-4" /> Registrar cobro
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Cobros anteriores */}
      {st.payments.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Cobros</h4>
          <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
            {st.payments.map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="text-muted-foreground">{formatDateTime(p.paidAt)}</span>
                  {' · '}{p.salesCount} {p.salesCount === 1 ? 'comida' : 'comidas'} {formatMoney(p.debt)}
                  {' + '}{p.surchargePct}% {formatMoney(p.surcharge)}
                  {' · '}{PAYMENT_LABEL[p.paymentMethod]}
                  {p.registeredByName && <span className="text-muted-foreground"> · {p.registeredByName}</span>}
                  {p.notes && <span className="italic text-muted-foreground"> · “{p.notes}”</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatMoney(p.total)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setCancelling(p)} title="Anular este cobro">
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {paying && (
        <PaymentDialog customer={customer} saleIds={[...checked]} debt={selectedDebt}
          onClose={() => setPaying(false)} onDone={() => { setPaying(false); setChecked(new Set()); refresh(); }} />
      )}
      {cancelling && (
        <CancelPaymentDialog payment={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); refresh(); }} />
      )}
    </section>
  );
}

function PaymentDialog({ customer, saleIds, debt, onClose, onDone }: {
  customer: AccountCustomer; saleIds: number[]; debt: number; onClose: () => void; onDone: () => void;
}) {
  const [pct, setPct] = useState(String(DEFAULT_SURCHARGE));
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const pctNum = Number(pct.replace(',', '.'));
  const valid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 300;
  const debtCents = Math.round(debt * 100);
  const surcharge = valid ? Math.round((debtCents * Math.round(pctNum * 100)) / 10_000) / 100 : 0;

  async function save() {
    if (!valid) { toast.error('El recargo tiene que ser un número entre 0 y 300'); return; }
    setSaving(true);
    try {
      await accountsApi.registerPayment(customer.id, { saleIds, surchargePct: pctNum, paymentMethod: method, notes: notes.trim() || null });
      toast.success(`Cobro de ${customer.name}: ${formatMoney(debt + surcharge)}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo registrar el cobro');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar cobro · {customer.name}</DialogTitle>
          <DialogDescription>{saleIds.length} {saleIds.length === 1 ? 'comida' : 'comidas'} a cuenta. El recargo queda aparte.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pct">Recargo (%)</Label>
              <Input id="pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">Cómo pagó</Label>
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={saving}>
                {PAYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pnotes">Nota</Label>
            <Input id="pnotes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} placeholder="Ej.: factura 0001-00001234" />
          </div>
          <div className="space-y-1 rounded-2xl border border-border p-3 text-sm">
            <div className="flex justify-between"><span>Comidas</span><span className="tabular-nums">{formatMoney(debt)}</span></div>
            <div className="flex justify-between"><span>Recargo {valid ? `${pctNum}%` : ''}</span><span className="tabular-nums">{formatMoney(surcharge)}</span></div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total a cobrar</span><span className="tabular-nums text-amber-300">{formatMoney(debt + surcharge)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !valid}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelPaymentDialog({ payment, onClose, onDone }: {
  payment: AccountStatement['payments'][number]; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (reason.trim().length < 3) { toast.error('Escribí el motivo'); return; }
    setSaving(true);
    try {
      await accountsApi.cancelPayment(payment.id, reason.trim());
      toast.success('Cobro anulado: esas comidas vuelven a deberse');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo anular');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Anular el cobro de {formatMoney(payment.total)}?</DialogTitle>
          <DialogDescription>Las comidas vuelven a figurar como deuda. Queda registrado en Auditoría.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="creason">Motivo *</Label>
          <Input id="creason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} placeholder="Ej.: se cargó en el cliente equivocado" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Volver</Button>
          <Button variant="destructive" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Anular cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDialog({ customer, onClose, onDeleted }: { customer: AccountCustomer | null; onClose: () => void; onDeleted: () => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(customer?.name ?? '');
  const [cuit, setCuit] = useState(customer?.cuit ?? '');
  const [contact, setContact] = useState(customer?.contact ?? '');
  const [active, setActive] = useState(customer?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error('Poné el nombre'); return; }
    setSaving(true);
    try {
      const data = { name: name.trim(), cuit: cuit.trim() || null, contact: contact.trim() || null };
      if (customer) await accountsApi.update(customer.id, { ...data, active });
      else await accountsApi.create(data);
      toast.success(customer ? 'Cliente actualizado' : 'Cliente agregado');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!customer) return;
    if (!await confirm({ title: `¿Borrar a ${customer.name}?`, description: 'Solo se puede si nunca tuvo comidas a cuenta.', variant: 'destructive', confirmLabel: 'Borrar' })) return;
    try {
      await accountsApi.remove(customer.id);
      toast.success('Cliente borrado');
      onDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo borrar');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? `Editar ${customer.name}` : 'Nuevo cliente con cuenta corriente'}</DialogTitle>
          <DialogDescription>Organismos o empresas que comen y pagan después contra factura.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cname">Nombre *</Label>
            <Input id="cname" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="Ej.: Municipalidad" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ccuit">CUIT</Label>
              <Input id="ccuit" maxLength={20} value={cuit} onChange={(e) => setCuit(e.target.value)} disabled={saving} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ccontact">Contacto</Label>
              <Input id="ccontact" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} disabled={saving} placeholder="Nombre / teléfono" />
            </div>
          </div>
          {customer && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={saving} />
              Activo (se le pueden dejar mesas a cuenta)
            </label>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {customer ? (
            <Button variant="ghost" onClick={remove} disabled={saving}><Trash2 className="h-4 w-4" /> Borrar</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
