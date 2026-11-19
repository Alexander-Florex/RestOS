// ──────────────────────────────────────────────
// PrinterPage.tsx — Comandera (tarea 1.1)
//
// Todo lo que se manda a imprimir (comandas, tickets de caja, cambios de platos)
// aparece acá al instante, dibujado tal como sale en papel, con su estado: en cola,
// impreso, reintentando o "no salió". Desde acá el Administrador elige la impresora
// (la Xprinter por USB que aparece en Windows, o una IP de red) y se imprime la hoja
// de prueba.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, Ban, Check, CheckCircle2, ChefHat, Clock, Eye, FileText, Loader2, Network, Printer, Receipt, RefreshCw, RotateCcw, Usb,
} from 'lucide-react';
import type { PaperWidth, TicketDoc } from '@shared/ticket';
import { printingApi, ApiError, type PrintJob, type SampleKind, type WindowsPrinter } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { usePrinterStatus } from '../hooks/usePrinterStatus';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { TicketPaper } from './TicketPaper';

const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' });

type Filter = 'all' | 'kitchen' | 'cash';
type Selected = { type: 'job'; id: number } | { type: 'sample'; kind: SampleKind; doc: TicketDoc };

const SAMPLE_LABEL: Record<SampleKind, string> = { kitchen: 'comanda', cash: 'ticket de caja', test: 'hoja de prueba' };
const IP = /^(?:tcp:\/\/)?\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/i;

function statusChip(job: PrintJob, active: boolean): { label: string; className: string; icon: typeof Clock } {
  switch (job.status) {
    case 'PRINTED': return { label: 'Impreso', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2 };
    case 'FAILED': return { label: 'No salió', className: 'border-red-400/30 bg-red-500/10 text-red-300', icon: AlertTriangle };
    case 'DISCARDED': return { label: 'Descartado', className: 'border-white/10 bg-white/5 text-muted-foreground', icon: Ban };
    default:
      if (job.attempts > 0) return { label: 'Reintentando', className: 'border-amber-400/30 bg-amber-500/10 text-amber-300', icon: RefreshCw };
      return active
        ? { label: 'En cola', className: 'border-sky-400/30 bg-sky-500/10 text-sky-300', icon: Clock }
        : { label: 'Solo pantalla', className: 'border-white/10 bg-white/5 text-muted-foreground', icon: Eye };
  }
}

/** Lo que llega por socket al crearse un ticket, en la forma de la lista */
function fromSocket(p: Record<string, unknown>): PrintJob | null {
  if (typeof p.jobId !== 'number' || !p.doc) return null;
  const created = String(p.createdAt ?? new Date().toISOString());
  return {
    id: p.jobId,
    kind: p.type === 'cash' ? 'cash' : p.type === 'test' ? 'test' : 'kitchen',
    title: String(p.title ?? ''),
    status: (p.status as PrintJob['status']) ?? 'PENDING',
    error: null,
    attempts: 0,
    reprintOfId: null,
    createdAt: created,
    queuedAt: created,
    printedAt: null,
    doc: p.doc as TicketDoc,
  };
}

// ──────────────────────────────────────────────
// Impresora: cuál es, si anda, y elegirla
// ──────────────────────────────────────────────
function PrinterCard({ canConfigure, paperWidth, onPaperWidth, busy }: {
  canConfigure: boolean;
  paperWidth: PaperWidth;
  onPaperWidth: (w: PaperWidth) => void;
  busy: boolean;
}) {
  const { status, refresh } = usePrinterStatus(true);
  const [choosing, setChoosing] = useState(false);
  const [list, setList] = useState<{ supported: boolean; printers: WindowsPrinter[]; suggested: string | null } | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [ip, setIp] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function openChooser() {
    setChoosing(true);
    setLoadingList(true);
    try {
      const res = await printingApi.printers();
      setList(res);
      const current = status?.printerName ?? '';
      if (current && IP.test(current)) { setIp(current); setChoice('__ip'); }
      else setChoice(current || res.suggested || '');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo leer la lista de impresoras');
      setList({ supported: false, printers: [], suggested: null });
    } finally {
      setLoadingList(false);
    }
  }

  async function save(printerName: string | null) {
    setSaving(true);
    try {
      await printingApi.saveSettings({ printerName });
      toast.success(printerName ? `Listo: los tickets salen por ${printerName}` : 'Sin impresora: los tickets solo se ven en pantalla');
      setChoosing(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function printTest() {
    setTesting(true);
    try {
      await printingApi.printSample('test');
      toast.success('Hoja de prueba enviada: fijate que salga entera, con la ñ y los acentos');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar');
    } finally {
      setTesting(false);
    }
  }

  if (!status) return null;
  const isNetwork = !!status.printerName && IP.test(status.printerName);
  const retrying = status.pending > 0 && !!status.lastError;

  return (
    <section className="glass space-y-3 rounded-3xl p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', status.active && !retrying ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>
          {isNetwork ? <Network className="h-5 w-5" /> : status.printerName ? <Usb className="h-5 w-5" /> : <Printer className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Impresora</h3>
          {!status.printerName ? (
            <p className="text-sm text-amber-200">Todavía no hay impresora elegida: los tickets se ven acá pero <b>no salen en papel</b>.</p>
          ) : !status.workerOn ? (
            <p className="text-sm text-amber-200">Elegida: <b>{status.printerName}</b>, pero la impresión está apagada en este servidor (PRINTER_WORKER=off).</p>
          ) : retrying ? (
            <p className="text-sm text-amber-200"><b>{status.printerName}</b>: reintentando. {status.lastError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Los tickets salen por <b className="text-foreground">{status.printerName}</b>
              {status.lastOkAt ? ` · último impreso ${timeFmt.format(new Date(status.lastOkAt))}` : ''}
              {status.pending > 0 ? ` · ${status.pending} en cola` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Ancho del papel">
            {([80, 58] as PaperWidth[]).map(w => (
              <button
                key={w}
                type="button"
                disabled={!canConfigure || busy}
                onClick={() => onPaperWidth(w)}
                title={canConfigure ? `Papel de ${w} mm` : 'Lo cambia el Administrador'}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', paperWidth === w ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground', !canConfigure && paperWidth !== w && 'opacity-50')}
              >
                {w} mm
              </button>
            ))}
          </div>
          {status.printerName && status.workerOn && (
            <Button size="sm" variant="outline" onClick={printTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Imprimir prueba
            </Button>
          )}
          {canConfigure && !choosing && (
            <Button size="sm" onClick={openChooser}><Printer className="h-4 w-4" /> {status.printerName ? 'Cambiar impresora' : 'Elegir impresora'}</Button>
          )}
        </div>
      </div>

      {choosing && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          {loadingList ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando las impresoras instaladas en la PC del servidor…</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Elegí la comandera. La Xprinter enchufada por USB aparece con el nombre que le puso Windows (por ejemplo "XP-80C" o "POS-80").
                {list && !list.supported && ' Este servidor no es Windows: solo se puede usar por red.'}
              </p>
              <div className="space-y-1.5" role="radiogroup">
                {list?.printers.map(p => (
                  <label key={p.name} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm', choice === p.name ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/5 hover:bg-white/[0.04]')}>
                    <input type="radio" name="printer" className="accent-current" checked={choice === p.name} onChange={() => setChoice(p.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[p.driver, p.port].filter(Boolean).join(' · ')}</span>
                    </span>
                    {p.name === list.suggested && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">Parece la comandera</span>}
                    {p.offline && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">Desconectada</span>}
                  </label>
                ))}
                <label className={cn('flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm', choice === '__ip' ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/5 hover:bg-white/[0.04]')}>
                  <input type="radio" name="printer" className="accent-current" checked={choice === '__ip'} onChange={() => setChoice('__ip')} />
                  <span className="font-medium">Por red (cable de red)</span>
                  <input
                    value={ip}
                    onChange={e => { setIp(e.target.value); setChoice('__ip'); }}
                    placeholder="192.168.1.50"
                    inputMode="decimal"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 py-1 text-sm"
                    aria-label="IP de la impresora"
                  />
                </label>
                {list && list.supported && list.printers.length === 0 && (
                  <p className="text-sm text-amber-200">Windows no tiene ninguna impresora instalada. Hay que instalar el driver de la Xprinter (viene en el CD o en la web de Xprinter) y volver a buscar.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={saving || !choice || (choice === '__ip' && !IP.test(ip.trim()))}
                  onClick={() => save(choice === '__ip' ? ip.trim() : choice)}
                >
                  <Check className="h-4 w-4" /> Usar esta
                </Button>
                <Button size="sm" variant="outline" onClick={openChooser} disabled={saving}><RefreshCw className="h-4 w-4" /> Buscar de nuevo</Button>
                {status.printerName && (
                  <Button size="sm" variant="ghost" onClick={() => save(null)} disabled={saving}>Sin impresora</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setChoosing(false)} disabled={saving}>Cancelar</Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function PrinterPage() {
  const { can } = useAuth();
  const canConfigure = can('tables.manage');
  const { status, retry, discard } = usePrinterStatus(true);
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

  // Lo nuevo aparece al instante, y cada cambio de estado también
  useEffect(() => {
    const socket = getSocket();
    const onPrint = (payload: Record<string, unknown>) => {
      const job = fromSocket(payload);
      if (!job) return;
      setJobs(prev => (prev ? [job, ...prev.filter(j => j.id !== job.id)].slice(0, 200) : [job]));
      setSelected(prev => (follow || !prev ? { type: 'job', id: job.id } : prev));
    };
    const onUpdated = (job: PrintJob) => {
      setJobs(prev => prev?.map(j => (j.id === job.id ? job : j)) ?? prev);
    };
    socket.on(SocketEvents.PRINT_REQUEST, onPrint);
    socket.on(SocketEvents.PRINT_JOB_UPDATED, onUpdated);
    return () => {
      socket.off(SocketEvents.PRINT_REQUEST, onPrint);
      socket.off(SocketEvents.PRINT_JOB_UPDATED, onUpdated);
    };
  }, [follow]);

  const visible = useMemo(
    () => (jobs ?? []).filter(j => filter === 'all' || j.kind === filter || (filter === 'kitchen' && j.kind === 'test')),
    [jobs, filter],
  );

  // Sin nada elegido: el último
  useEffect(() => {
    if (!selected && visible.length > 0) setSelected({ type: 'job', id: visible[0].id });
  }, [selected, visible]);

  const current = selected?.type === 'job' ? jobs?.find(j => j.id === selected.id) ?? null : null;
  const doc = selected?.type === 'sample' ? selected.doc : current?.doc ?? null;
  const active = !!status?.active;

  async function showSample(kind: SampleKind, width = paperWidth) {
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
      await printingApi.saveSettings({ paperWidth: w });
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
      toast.success(active ? 'Enviado a la comandera' : 'Agregado a la lista (sin impresora elegida no sale en papel)');
      setFollow(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar');
    } finally {
      setBusy(false);
    }
  }

  if (!jobs) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Impresión</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Comandera</h2>
        <p className="text-sm text-muted-foreground">Cada comanda y ticket de caja aparece acá al instante, tal como sale en papel, y se ve si salió.</p>
      </div>

      <PrinterCard canConfigure={canConfigure} paperWidth={paperWidth} onPaperWidth={changeWidth} busy={busy} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Ver cómo queda:</span>
        <Button variant="outline" size="sm" onClick={() => showSample('kitchen')}><Eye className="h-4 w-4" /> Comanda</Button>
        <Button variant="outline" size="sm" onClick={() => showSample('cash')}><Eye className="h-4 w-4" /> Ticket de caja</Button>
        <Button variant="outline" size="sm" onClick={() => showSample('test')}><Eye className="h-4 w-4" /> Hoja de prueba</Button>
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
                const st = statusChip(j, active);
                const isSel = selected?.type === 'job' && selected.id === j.id;
                const Icon = j.kind === 'cash' ? Receipt : j.kind === 'test' ? FileText : ChefHat;
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected({ type: 'job', id: j.id }); setFollow(false); }}
                      className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition', isSel ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]')}
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
                  {selected?.type === 'sample' ? `Ejemplo · ${SAMPLE_LABEL[selected.kind]} (todavía no se mandó)` : current?.title}
                </p>
                {selected?.type === 'sample' ? (
                  <Button size="sm" onClick={printSample} disabled={busy}><Printer className="h-4 w-4" /> Mandar a la comandera</Button>
                ) : current && (current.status === 'FAILED' ? (
                  <>
                    <Button size="sm" onClick={() => retry(current.id)}><RotateCcw className="h-4 w-4" /> Reintentar</Button>
                    <Button size="sm" variant="outline" onClick={() => discard(current.id)}><Check className="h-4 w-4" /> Ya está</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={reprint} disabled={busy}><RotateCcw className="h-4 w-4" /> Reimprimir</Button>
                ))}
              </div>
              {current?.error && current.status !== 'PRINTED' && (
                <p className={cn('rounded-lg border p-2 text-sm', current.status === 'FAILED' ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200')}>
                  {current.status === 'FAILED' ? 'No salió: ' : ''}{current.error}
                </p>
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
