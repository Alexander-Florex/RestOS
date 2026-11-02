// ──────────────────────────────────────────────
// AuditPage.tsx — Registro de auditoría (tarea 1.2). Solo lectura.
// Quién cobró, anuló, cambió precios, stock, usuarios o roles, y cuándo.
// Permiso audit.view (por defecto, solo Administrador).
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ShieldAlert, ChevronDown } from 'lucide-react';
import { auditApi, ApiError, type AuditEntry, type PaymentMethod } from '../lib/api';
import { PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatDateTime, formatMoney } from '../lib/format';
import { parseLocalDate, localDateString } from '../lib/reservation-helpers';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

// Grupos del filtro → acciones (exactas o prefijos) que entiende la API
const GROUPS: Array<{ id: string; label: string; actions: string }> = [
  { id: '',        label: 'Todo',              actions: '' },
  { id: 'cobros',  label: 'Cobros',            actions: 'sale.create,takeaway.pay' },
  { id: 'anul',    label: 'Anulaciones',       actions: 'order.cancel,takeaway.cancel' },
  { id: 'carta',   label: 'Carta y precios',   actions: 'menu' },
  { id: 'stock',   label: 'Stock',             actions: 'inventory' },
  { id: 'cuentas', label: 'Usuarios y roles',  actions: 'user,role' },
];

const ACTION_LABEL: Record<string, { label: string; tone: string }> = {
  'sale.create':       { label: 'Cobro de mesa',        tone: 'bg-brand-500/15 text-brand-300' },
  'takeaway.pay':      { label: 'Cobro para llevar',    tone: 'bg-brand-500/15 text-brand-300' },
  'takeaway.cancel':   { label: 'Para llevar cancelado', tone: 'bg-rose-500/15 text-rose-300' },
  'order.cancel':      { label: 'Pedido anulado',       tone: 'bg-rose-500/15 text-rose-300' },
  'menu.price':        { label: 'Cambio de precio',     tone: 'bg-amber-500/15 text-amber-300' },
  'menu.options':      { label: 'Opciones del plato',   tone: 'bg-amber-500/15 text-amber-300' },
  'menu.delete':       { label: 'Plato borrado',        tone: 'bg-rose-500/15 text-rose-300' },
  'inventory.restock': { label: 'Reposición',           tone: 'bg-sky-500/15 text-sky-300' },
  'inventory.consume': { label: 'Consumo de stock',     tone: 'bg-sky-500/15 text-sky-300' },
  'inventory.update':  { label: 'Ajuste de stock/costo', tone: 'bg-amber-500/15 text-amber-300' },
  'inventory.delete':  { label: 'Insumo borrado',       tone: 'bg-rose-500/15 text-rose-300' },
  'user.create':       { label: 'Usuario creado',       tone: 'bg-white/[0.08] text-foreground/80' },
  'user.update':       { label: 'Usuario modificado',   tone: 'bg-white/[0.08] text-foreground/80' },
  'user.toggle':       { label: 'Usuario (des)activado', tone: 'bg-white/[0.08] text-foreground/80' },
  'user.delete':       { label: 'Usuario borrado',      tone: 'bg-rose-500/15 text-rose-300' },
  'role.create':       { label: 'Rol creado',           tone: 'bg-white/[0.08] text-foreground/80' },
  'role.update':       { label: 'Rol modificado',       tone: 'bg-white/[0.08] text-foreground/80' },
  'role.delete':       { label: 'Rol borrado',          tone: 'bg-rose-500/15 text-rose-300' },
};

const FIELD_LABEL: Record<string, string> = {
  username: 'usuario', name: 'nombre', email: 'email', role: 'rol', active: 'activo',
  quantity: 'cantidad', costPerUnit: 'costo', minStock: 'stock mínimo', price: 'precio', permissions: 'permisos',
};

type Data = Record<string, any>;

const pay = (m: unknown) => PAYMENT_LABEL[m as PaymentMethod] ?? String(m ?? '');

/** Una línea legible por registro. */
function summary(e: AuditEntry): string {
  const b = (e.before ?? {}) as Data;
  const a = (e.after ?? {}) as Data;
  switch (e.action) {
    case 'sale.create':
      return `Mesa ${a.tableNumber} · ${formatMoney(a.total)} · ${pay(a.paymentMethod)}`;
    case 'takeaway.pay':
      return `${a.customerName} · ${formatMoney(a.total)} · ${pay(a.paymentMethod)}`;
    case 'takeaway.cancel':
      return `${b.customerName} · ${b.total != null ? formatMoney(b.total) : ''}`;
    case 'order.cancel':
      return `Pedido #${e.entityId} · ${(b.items ?? []).map((i: Data) => `${i.quantity}x ${i.itemName}`).join(', ')} · ${formatMoney(b.total ?? 0)}`;
    case 'menu.price':
      return `${a.name}: ${formatMoney(b.price)} → ${formatMoney(a.price)}`;
    case 'menu.options':
      return `${a.name}: ${(a.groups ?? []).length} grupo(s) de opciones`;
    case 'menu.delete':
      return `${b.name} (${formatMoney(b.price)})`;
    case 'inventory.restock':
      return `${b.name}: +${a.amount} ${b.unit} (${b.quantity} → ${a.quantity})`;
    case 'inventory.consume':
      return `${b.name}: −${a.amount} ${b.unit} (${b.quantity} → ${a.quantity})`;
    case 'inventory.update':
    case 'user.update':
    case 'role.update': {
      const keys = Object.keys(a).filter(k => !['name', 'unit', 'username'].includes(k));
      const who = b.name ?? b.username ?? a.name ?? '';
      const parts = keys.map(k => k === 'cambioDeClave'
        ? 'cambió la contraseña'
        : k === 'permissions'
          ? `permisos (${(b.permissions ?? []).length} → ${(a.permissions ?? []).length})`
          : `${FIELD_LABEL[k] ?? k}: ${fmt(b[k])} → ${fmt(a[k])}`);
      return `${who}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    }
    case 'inventory.delete':
      return `${b.name} (${b.quantity} ${b.unit})`;
    case 'user.create':
      return `${a.name} (${a.username}) · rol ${a.role}`;
    case 'user.toggle':
      return `${b.username}: ${a.active ? 'activado' : 'desactivado'}`;
    case 'user.delete':
      return `${b.name} (${b.username})`;
    case 'role.create':
    case 'role.delete':
      return `${(a.name ?? b.name)} · ${((a.permissions ?? b.permissions) ?? []).length} permisos`;
    default:
      return `${e.entity}${e.entityId ? ` #${e.entityId}` : ''}`;
  }
}

function fmt(v: unknown): string {
  if (v === true) return 'sí';
  if (v === false) return 'no';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export function AuditPage() {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d; });
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState('');
  const [userId, setUserId] = useState<number | ''>('');
  const [actors, setActors] = useState<Array<{ userId: number | null; userName: string }>>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  const actions = GROUPS.find(g => g.id === group)?.actions || undefined;

  async function load(nextPage = 1) {
    setLoading(true);
    try {
      const res = await auditApi.list({ from, to, action: actions, userId: userId || undefined, page: nextPage, pageSize: 50 });
      setEntries(prev => (nextPage === 1 ? res.entries : [...prev, ...res.entries]));
      setTotal(res.total);
      setPage(nextPage);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar la auditoría');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, [from.getTime(), to.getTime(), group, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { auditApi.actors().then(r => setActors(r.actors)).catch(() => {}); }, []);

  const quick = (days: number) => {
    const f = new Date(today); f.setDate(f.getDate() - (days - 1));
    setFrom(f); setTo(today);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400">
            <span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Administración
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Auditoría</h2>
          <p className="text-sm text-muted-foreground">Quién cobró, anuló, cambió precios, stock o usuarios, y cuándo</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(1)} disabled={loading} aria-label="Refrescar">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Filtros */}
      <div className="mb-4 space-y-3 rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {[['Hoy', 1], ['7 días', 7], ['30 días', 30]].map(([label, days]) => (
            <button key={label} onClick={() => quick(days as number)}
              className="rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              {label}
            </button>
          ))}
          <input type="date" aria-label="Desde" value={localDateString(from)} max={localDateString(to)}
            onChange={e => { const d = parseLocalDate(e.target.value); if (d) setFrom(d); }}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs" />
          <span className="text-xs text-muted-foreground">a</span>
          <input type="date" aria-label="Hasta" value={localDateString(to)} min={localDateString(from)}
            onChange={e => { const d = parseLocalDate(e.target.value); if (d) setTo(d); }}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs" />
          <select aria-label="Usuario" value={userId} onChange={e => setUserId(e.target.value ? Number(e.target.value) : '')}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
            <option value="">Todos los usuarios</option>
            {actors.filter(a => a.userId).map(a => <option key={a.userId!} value={a.userId!}>{a.userName}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map(g => (
            <button key={g.id || 'all'} onClick={() => setGroup(g.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                group === g.id ? 'border-brand-500/50 bg-brand-500/10 text-brand-400' : 'border-border bg-white/[0.04] text-muted-foreground',
              )}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Registro */}
      {!loading && entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
          <ShieldAlert className="mx-auto mb-2 h-6 w-6 opacity-60" />
          No hay registros con esos filtros
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <ul className="divide-y divide-border">
            {entries.map(e => {
              const info = ACTION_LABEL[e.action] ?? { label: e.action, tone: 'bg-white/[0.08]' };
              const expanded = open === e.id;
              return (
                <li key={e.id} className="text-sm">
                  <button onClick={() => setOpen(expanded ? null : e.id)} aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-white/[0.025]">
                    <span className="w-32 shrink-0 tabular-nums text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', info.tone)}>{info.label}</span>
                    <span className="min-w-0 flex-1 truncate">{summary(e)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{e.userName ?? 'Sistema'}</span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                  </button>
                  {e.reason && (
                    <p className="px-3 pb-2 text-xs text-amber-200">Motivo: {e.reason}</p>
                  )}
                  {expanded && (
                    <div className="grid gap-2 bg-black/20 px-3 py-3 text-xs sm:grid-cols-2">
                      <Detail title="Antes" data={e.before} />
                      <Detail title="Después" data={e.after} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{entries.length} de {total} registros</span>
        {entries.length < total && (
          <Button variant="outline" size="sm" onClick={() => load(page + 1)} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Cargar más
          </Button>
        )}
      </div>
    </div>
  );
}

function Detail({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return (
    <div>
      <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {data ? (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/[0.03] p-2 font-mono text-[11px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}
