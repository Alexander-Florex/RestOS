// ──────────────────────────────────────────────
// PrinterPage.tsx — Comandera (tarea 1.1)
//
// Todo lo que se manda a imprimir (comandas, tickets de caja, cambios de platos)
// aparece acá al instante, dibujado tal como sale en papel. Sirve para ver cómo
// quedan los tickets, para probar sin impresora y para reimprimir.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChefHat, Clock, Eye, Loader2, Printer, Receipt, RotateCcw } from 'lucide-react';
import type { PaperWidth, TicketDoc } from '@shared/ticket';
import { printingApi, ApiError, type PrintJob } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { TicketPaper } from './TicketPaper';

const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' });

type Filter = 'all' | 'kitchen' | 'cash';
type Selected = { type: 'job'; id: number } | { type: 'sample'; kind: 'kitchen' | 'cash'; doc: TicketDoc };

const STATUS: Record<PrintJob['status'], { label: string; className: string; icon: typeof Clock }> = {
  PENDING: { label: 'Sin confirmar', className: 'border-amber-400/30 bg-amber-500/10 text-amber-300', icon: Clock },
  PRINTED: { label: 'Impreso', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2 },
  FAILED: { label: 'No imprimió', className: 'border-red-400/30 bg-red-500/10 text-red-300', icon: AlertTriangle },
};

/** Lo que llega por socket (datos + ticket armado) en la forma de la lista */
function fromSocket(p: Record<string, unknown>): PrintJob | null {
  if (typeof p.jobId !== 'number' || !p.doc) return null;
  return {
    id: p.jobId,
    kind: p.type === 'cash' ? 'cash' : 'kitchen',
    title: String(p.title ?? ''),
    status: (p.status as PrintJob['status']) ?? 'PENDING',
    error: null,
    reprintOfId: null,
    createdAt: String(p.createdAt ?? new Date().toISOString()),
    printedAt: null,
    doc: p.doc as TicketDoc,
  };
}

export function PrinterPage() {
  const { can } = useAuth();
  const canConfigure = can('tables.manage');
  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(80);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([printingApi.jobs(), printingApi.settings()]);
      setJobs(list);
      setPaperWidth(settings.paperWidth);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar la comandera');
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useResync(refresh);

  // Lo nuevo aparece al instante
  useEffect(() => {
    const socket = getSocket();
    const onPrint = (payload: Record<string, unknown>) => {
      const job = fromSocket(payload);
      if (!job) return;
      setJobs(prev => (prev ? [job, ...prev.filter(j => j.id !== job.id)].slice(0, 200) : [job]));
      setSelected(prev => (follow || !prev ? { type: 'job', id: job.id } : prev));
    };
    socket.on(SocketEvents.PRINT_REQUEST, onPrint);
    return () => { socket.off(SocketEvents.PRINT_REQUEST, onPrint); };
  }, [follow]);

  const visible = useMemo(() => (jobs ?? []).filter(j => filter === 'all' || j.kind === filter), [jobs, filter]);

  // Sin nada elegido: el último
  useEffect(() => {
    if (!selected && visible.length > 0) setSelected({ type: 'job', id: visible[0].id });
  }, [selected, visible]);

  const current = selected?.type === 'job' ? jobs?.find(j => j.id === selected.id) ?? null : null;
  const doc = selected?.type === 'sample' ? selected.doc : current?.doc ?? null;

  async function showSample(kind: 'kitchen' | 'cash', width = paperWidth) {
    try {
      setSelected({ type: 'sample', kind, doc: await printingApi.sample(kind, width) });
      setFollow(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo armar el ejemplo');
    }
  }

  async function changeWidth(w: PaperWidth) {
    if (w === paperWidth) return;
    setBusy(true);
    try {
      await printingApi.saveSettings(w);
      setPaperWidth(w);
      toast.success(`Papel de ${w} mm: los próximos tickets salen con ${w === 80 ? 48 : 32} caracteres por línea`);
      if (selected?.type === 'sample') await showSample(selected.kind, w);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function reprint() {
    if (!current) return;
    setBusy(true);
    try {
      await printingApi.reprint(current.id);
      toast.success('Ticket enviado otra vez');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo reimprimir');
    } finally {
      setBusy(false);
    }
  }

  async function printSample() {
    if (selected?.type !== 'sample') return;
    setBusy(true);
    try {
      await printingApi.printSample(selected.kind);
      toast.success('Ejemplo enviado a la comandera');
      setFollow(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar');
    } finally {
      setBusy(false);
    }
  }

  if (!jobs) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const anyConfirmed = jobs.some(j => j.status !== 'PENDING');

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Impresión</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Comandera</h2>
        <p className="text-sm text-muted-foreground">Cada comanda y ticket de caja que se manda a imprimir aparece acá al instante, tal como sale en papel.</p>
      </div>

      {!anyConfirmed && (
        <div className="flex gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Todavía no hay una impresora confirmando los tickets: quedan como <b>"Sin confirmar"</b>. Cuando se instale el agente de impresión en la PC del local, cada ticket va a pasar a "Impreso" o avisar si falló.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Ancho del papel">
          {([80, 58] as PaperWidth[]).map(w => (
            <button
              key={w}
              type="button"
              disabled={!canConfigure || busy}
              onClick={() => changeWidth(w)}
              title={canConfigure ? `Papel de ${w} mm` : 'Lo cambia el Administrador'}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', paperWidth === w ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground', !canConfigure && paperWidth !== w && 'opacity-50')}
            >
              {w} mm
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => showSample('kitchen')}><Eye className="h-4 w-4" /> Ejemplo de comanda</Button>
        <Button variant="outline" size="sm" onClick={() => showSample('cash')}><Eye className="h-4 w-4" /> Ejemplo de ticket de caja</Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Lista */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1">
            {([['all', 'Todo'], ['kitchen', 'Comandas'], ['cash', 'Caja']] as [Filter, string][]).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn('rounded-full px-3 py-1 text-xs font-medium', filter === f ? 'bg-brand-500/20 text-brand-200' : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="accent-current" />
              Mostrar lo último
            </label>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
              Todavía no se mandó nada a imprimir. Tomá un pedido o mirá un ejemplo.
            </p>
          ) : (
            <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
              {visible.map(j => {
                const st = STATUS[j.status];
                const active = selected?.type === 'job' && selected.id === j.id;
                const Icon = j.kind === 'cash' ? Receipt : ChefHat;
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected({ type: 'job', id: j.id }); setFollow(false); }}
                      className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition', active ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]')}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{j.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {dayFmt.format(new Date(j.createdAt))} {timeFmt.format(new Date(j.createdAt))}
                          {j.reprintOfId ? ' · reimpresión' : ''}
                        </span>
                      </span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', st.className)}>
                        <st.icon className="h-3 w-3" /> {st.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Ticket */}
        <div className="min-w-0 space-y-3">
          {doc ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {selected?.type === 'sample' ? `Ejemplo · ${selected.kind === 'cash' ? 'ticket de caja' : 'comanda'} (no se imprimió)` : current?.title}
                </p>
                {selected?.type === 'sample' ? (
                  <Button size="sm" onClick={printSample} disabled={busy}><Printer className="h-4 w-4" /> Mandar a la comandera</Button>
                ) : current && (
                  <Button size="sm" variant="outline" onClick={reprint} disabled={busy}><RotateCcw className="h-4 w-4" /> Reimprimir</Button>
                )}
              </div>
              {current?.status === 'FAILED' && current.error && (
                <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-200">No imprimió: {current.error}</p>
              )}
              <div className="rounded-2xl bg-neutral-800/60 p-4 sm:p-6">
                <TicketPaper doc={doc} />
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">Elegí un ticket de la lista o mirá un ejemplo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
