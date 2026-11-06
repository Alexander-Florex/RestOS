// ──────────────────────────────────────────────
// StockCountPage.tsx — Toma de inventario (tarea 3.3)
//
// Pensada para el celular: se elige el sector, aparece la lista en el orden
// de la planilla y se carga lo contado. Cada número se guarda al salir del
// campo; si no hay conexión queda guardado en el celular y se reenvía solo.
// Mientras se cuenta no se muestra lo que dice el sistema (conteo a ciegas).
// Al cerrar se revisan las diferencias y se corrige el stock.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, ChevronRight, ClipboardList, CloudOff, Loader2, MessageSquarePlus, Play, Search, X,
} from 'lucide-react';
import {
  ApiError, stockCountsApi, type StockCount, type StockCountLine, type StockCountPreview, type StockCountSummaryRow,
} from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { useStorageAreas } from '../hooks/useStorageAreas';
import { formatDateTime, formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { fmtQty } from './StockMovementsDialog';
import { useConfirm } from './ui/confirm-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';

const STATUS_LABEL: Record<StockCountSummaryRow['status'], string> = {
  OPEN: 'Abierto', CLOSED: 'Cerrado', CANCELLED: 'Descartado',
};

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/** "2,5" o "2.5" → 2.5; vacío → null; inválido → undefined. */
function parseQty(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// ── Números sin enviar: quedan en el celular hasta que el servidor los confirme ──
type Pending = Record<string, number | null>;
const pendingKey = (countId: number) => `restos.stockCount.${countId}.pending`;
function readPending(countId: number): Pending {
  try { return JSON.parse(localStorage.getItem(pendingKey(countId)) ?? '{}') as Pending; } catch { return {}; }
}
function writePending(countId: number, p: Pending) {
  try {
    if (Object.keys(p).length === 0) localStorage.removeItem(pendingKey(countId));
    else localStorage.setItem(pendingKey(countId), JSON.stringify(p));
  } catch { /* sin almacenamiento: se reintenta mientras la pantalla siga abierta */ }
}

export function StockCountPage() {
  const [openId, setOpenId] = useState<number | null>(null);
  return openId !== null
    ? <CountSheet id={openId} onBack={() => setOpenId(null)} />
    : <CountList onOpen={setOpenId} />;
}

// ──────────────────────────────────────────────
// Lista: empezar un conteo, seguir uno abierto, ver el historial
// ──────────────────────────────────────────────
function CountList({ onOpen }: { onOpen: (id: number) => void }) {
  const { areas } = useStorageAreas();
  const [counts, setCounts] = useState<StockCountSummaryRow[] | null>(null);
  const [areaId, setAreaId] = useState('');
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try { setCounts((await stockCountsApi.list()).counts); } catch { setCounts(c => c ?? []); }
  }, []);
  useResync(refresh);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const socket = getSocket();
    const on = () => { refresh(); };
    socket.on(SocketEvents.STOCK_COUNT_CHANGED, on);
    return () => { socket.off(SocketEvents.STOCK_COUNT_CHANGED, on); };
  }, [refresh]);

  // Por defecto, el primer sector con insumos
  useEffect(() => {
    if (areaId === '' && areas.length > 0) setAreaId(String(areas.find(a => a.itemCount > 0)?.id ?? areas[0].id));
  }, [areas, areaId]);

  async function start() {
    setStarting(true);
    try {
      const { count } = await stockCountsApi.create(areaId === 'ALL' ? null : Number(areaId));
      onOpen(count.id);
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo empezar el conteo'));
    } finally {
      setStarting(false);
    }
  }

  const open = counts?.filter(c => c.status === 'OPEN') ?? [];
  const history = counts?.filter(c => c.status !== 'OPEN') ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Carta y stock</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Conteo de stock</h2>
        <p className="text-sm text-muted-foreground">Contá por sector. Lo que no cargues no se toca.</p>
      </div>

      <section className="glass mb-6 space-y-3 rounded-3xl p-4">
        <Label htmlFor="countArea">Nuevo conteo</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select id="countArea" value={areaId} onChange={(e) => setAreaId(e.target.value)} className="h-12 flex-1 text-base">
            {areas.map(a => (
              <option key={a.id} value={String(a.id)} disabled={a.itemCount === 0}>
                {a.name} ({a.itemCount})
              </option>
            ))}
            <option value="ALL">Todo el stock</option>
          </Select>
          <Button className="h-12" onClick={start} disabled={starting || areaId === ''}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Empezar
          </Button>
        </div>
        {areas.length > 0 && areas.every(a => a.itemCount === 0) && (
          <p className="text-xs text-amber-300">Ningún insumo tiene sector todavía: asignalos en Inventario, o contá "Todo el stock".</p>
        )}
      </section>

      {counts === null ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {open.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">En curso</h3>
              <div className="space-y-2">{open.map(c => <CountRow key={c.id} c={c} onOpen={onOpen} />)}</div>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Historial</h3>
            {history.length === 0
              ? <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">Todavía no hay conteos cerrados</p>
              : <div className="space-y-2">{history.map(c => <CountRow key={c.id} c={c} onOpen={onOpen} />)}</div>}
          </section>
        </>
      )}
    </div>
  );
}

function CountRow({ c, onOpen }: { c: StockCountSummaryRow; onOpen: (id: number) => void }) {
  return (
    <button onClick={() => onOpen(c.id)}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-white/[0.04]">
      <ClipboardList className={cn('h-5 w-5 shrink-0', c.status === 'OPEN' ? 'text-brand-400' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.areaName}</p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(c.status === 'OPEN' ? c.startedAt : c.closedAt ?? c.startedAt)}
          {(c.closedByName ?? c.startedByName) && ` · ${c.closedByName ?? c.startedByName}`}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs">
        {c.status === 'OPEN' ? (
          <span className="tabular-nums text-brand-400">{c.countedLines}/{c.totalLines}</span>
        ) : c.status === 'CLOSED' ? (
          <>
            <span className="block tabular-nums">{c.differences} {c.differences === 1 ? 'diferencia' : 'diferencias'}</span>
            {c.differences > 0 && (
              <span className={cn('tabular-nums', c.differenceValue < 0 ? 'text-rose-300' : 'text-emerald-300')}>
                {formatMoney(c.differenceValue)}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{STATUS_LABEL[c.status]}</span>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ──────────────────────────────────────────────
// Hoja de conteo
// ──────────────────────────────────────────────
type SaveState = 'saving' | 'saved' | 'error';

function CountSheet({ id, onBack }: { id: number; onBack: () => void }) {
  const confirm = useConfirm();
  const [count, setCount] = useState<StockCount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [states, setStates] = useState<Record<number, SaveState>>({});
  const [pending, setPendingState] = useState<Pending>(() => readPending(id));
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const focused = useRef<number | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const pendingRef = useRef(pending);

  const setPending = useCallback((p: Pending) => {
    pendingRef.current = p;
    setPendingState(p);
    writePending(id, p);
  }, [id]);

  const load = useCallback(async () => {
    try {
      const { count } = await stockCountsApi.get(id);
      setCount(count);
      setLoadError(null);
      // Lo que el usuario está escribiendo o no se envió todavía, manda sobre lo del servidor
      setDrafts(prev => {
        const next = { ...prev };
        for (const l of count.lines) {
          if (focused.current === l.id || String(l.id) in pendingRef.current) continue;
          next[l.id] = l.countedQty === null ? '' : String(l.countedQty).replace('.', ',');
        }
        for (const [lineId, v] of Object.entries(pendingRef.current)) {
          if (!(Number(lineId) in prev)) next[Number(lineId)] = v === null ? '' : String(v).replace('.', ',');
        }
        return next;
      });
    } catch (err) {
      setLoadError(errMsg(err, 'No se pudo cargar el conteo'));
    }
  }, [id]);

  /** Envía un número. Si falla por conexión, queda pendiente en el celular. */
  const send = useCallback(async (lineId: number, value: number | null) => {
    setStates(s => ({ ...s, [lineId]: 'saving' }));
    try {
      const { line } = await stockCountsApi.setLine(id, lineId, { countedQty: value });
      const { [String(lineId)]: _sent, ...rest } = pendingRef.current;
      setPending(rest);
      setStates(s => ({ ...s, [lineId]: 'saved' }));
      setCount(c => c && { ...c, lines: c.lines.map(l => (l.id === lineId ? { ...l, ...line, areaName: l.areaName } : l)) });
    } catch (err) {
      // 400/404/409: el servidor lo rechazó (ej. el conteo ya se cerró) y reintentar no sirve.
      // Sin conexión, servidor caído o sesión vencida (401): queda pendiente y se reintenta.
      if (err instanceof ApiError && [400, 404, 409, 422].includes(err.status)) {
        const { [String(lineId)]: _rejected, ...rest } = pendingRef.current;
        setPending(rest);
        setStates(s => ({ ...s, [lineId]: 'error' }));
        toast.error(err.message);
        load();
      } else {
        setStates(s => ({ ...s, [lineId]: 'error' }));
      }
    }
  }, [id, load, setPending]);

  const flush = useCallback(() => {
    for (const [lineId, v] of Object.entries(pendingRef.current)) void send(Number(lineId), v);
  }, [send]);

  useEffect(() => { load().then(flush); }, [load, flush]);
  useResync(() => load().then(flush));
  useEffect(() => {
    const socket = getSocket();
    const on = (payload: { id: number }) => { if (payload.id === id) load(); };
    socket.on(SocketEvents.STOCK_COUNT_CHANGED, on);
    return () => { socket.off(SocketEvents.STOCK_COUNT_CHANGED, on); };
  }, [id, load]);

  function commit(line: StockCountLine) {
    const text = drafts[line.id] ?? '';
    const value = parseQty(text);
    if (value === undefined) {
      toast.error(`"${text}" no es una cantidad válida`);
      setStates(s => ({ ...s, [line.id]: 'error' }));
      return;
    }
    if (value === line.countedQty && !(String(line.id) in pendingRef.current)) return;
    setPending({ ...pendingRef.current, [line.id]: value });
    void send(line.id, value);
  }

  async function saveNote(line: StockCountLine, text: string) {
    const reason = text.trim() || null;
    if (reason === (line.reason ?? null)) return;
    try {
      const { line: saved } = await stockCountsApi.setLine(id, line.id, { reason });
      setCount(c => c && { ...c, lines: c.lines.map(l => (l.id === line.id ? { ...l, reason: saved.reason } : l)) });
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo guardar la nota'));
    }
  }

  async function discard() {
    const ok = await confirm({
      title: '¿Descartar este conteo?',
      description: 'No se cambia el stock. Lo cargado queda en el historial como descartado.',
      variant: 'destructive', confirmLabel: 'Descartar',
    });
    if (!ok) return;
    try {
      await stockCountsApi.cancel(id);
      setPending({});
      toast.success('Conteo descartado');
      onBack();
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo descartar'));
    }
  }

  const visible = useMemo(() => {
    if (!count) return [];
    const s = search.trim().toLowerCase();
    return count.lines.filter(l =>
      (!s || l.itemName.toLowerCase().includes(s))
      && (!onlyMissing || (drafts[l.id] ?? '') === ''));
  }, [count, search, onlyMissing, drafts]);

  if (loadError && !count) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Volver</Button>
      </div>
    );
  }
  if (!count) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (count.status !== 'OPEN') return <ClosedCount count={count} onBack={onBack} />;

  const countedCount = count.lines.filter(l => (drafts[l.id] ?? '') !== '').length;
  const pendingCount = Object.keys(pending).length;
  const groupByArea = count.storageAreaId === null;

  return (
    <div className="mx-auto max-w-2xl pb-28">
      {/* Encabezado fijo: sector, avance y búsqueda */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 space-y-2 border-b border-white/[0.06] bg-background/90 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold">{count.areaName}</p>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums text-brand-400">{countedCount}/{count.lines.length}</span> contados
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-300">
                  <CloudOff className="h-3 w-3" /> {pendingCount} sin enviar
                </span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="text-rose-300" onClick={discard}>Descartar</Button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${(countedCount / Math.max(count.lines.length, 1)) * 100}%` }} />
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar insumo" className="pl-9" />
          </div>
          <button type="button" onClick={() => setOnlyMissing(v => !v)}
            className={cn('shrink-0 rounded-xl border px-3 text-xs font-medium',
              onlyMissing ? 'border-brand-500/50 bg-brand-500/10 text-brand-400' : 'border-border text-muted-foreground')}>
            Sin contar
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {onlyMissing ? '¡Está todo contado!' : 'No hay insumos con ese nombre'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((line, idx) => {
            const showArea = groupByArea && (idx === 0 || visible[idx - 1].areaName !== line.areaName);
            const state = states[line.id];
            const isPending = String(line.id) in pending;
            return (
              <li key={line.id}>
                {showArea && (
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {line.areaName ?? 'Sin sector'}
                  </p>
                )}
                <div className={cn('rounded-2xl border bg-card p-3',
                  (drafts[line.id] ?? '') !== '' ? 'border-brand-500/25' : 'border-border')}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{line.itemName}</p>
                      <p className="text-xs text-muted-foreground">
                        en {line.unit}
                        {line.inventoryItemId === null && <span className="text-amber-300"> · insumo borrado</span>}
                      </p>
                    </div>
                    <div className="relative">
                      <Input
                        ref={(el) => { if (el) inputs.current.set(line.id, el); else inputs.current.delete(line.id); }}
                        type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off"
                        aria-label={`Cantidad de ${line.itemName} en ${line.unit}`}
                        className="h-12 w-28 pr-7 text-right text-lg tabular-nums"
                        value={drafts[line.id] ?? ''}
                        placeholder="—"
                        onFocus={() => { focused.current = line.id; }}
                        onChange={(e) => setDrafts(d => ({ ...d, [line.id]: e.target.value }))}
                        onBlur={() => { focused.current = null; commit(line); }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const next = visible[idx + 1];
                          const el = next && inputs.current.get(next.id);
                          if (el) el.focus(); else (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden>
                        {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          : isPending ? <CloudOff className="h-3.5 w-3.5 text-amber-300" />
                          : state === 'error' ? <X className="h-3.5 w-3.5 text-rose-300" />
                          : state === 'saved' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : null}
                      </span>
                    </div>
                  </div>
                  {noteOpen[line.id] || line.reason ? (
                    <Input className="mt-2 h-9 text-xs" maxLength={300} placeholder="Nota (ej. se venció una)"
                      defaultValue={line.reason ?? ''} autoFocus={noteOpen[line.id] && !line.reason}
                      onBlur={(e) => saveNote(line, e.target.value)} />
                  ) : (
                    <button type="button" onClick={() => setNoteOpen(n => ({ ...n, [line.id]: true }))}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <MessageSquarePlus className="h-3 w-3" /> Nota
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Barra inferior: revisar y cerrar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.06] bg-background/95 p-3 backdrop-blur md:left-[264px]">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <p className="flex-1 text-xs text-muted-foreground">
            {count.lines.length - countedCount > 0
              ? `${count.lines.length - countedCount} sin contar (no se tocan)`
              : 'Todo contado'}
          </p>
          <Button className="h-12" onClick={() => setReviewOpen(true)} disabled={countedCount === 0}>
            Revisar y cerrar
          </Button>
        </div>
      </div>

      <ReviewDialog
        open={reviewOpen} countId={id} pendingCount={pendingCount}
        onClose={closeReview}
        onClosed={() => { setReviewOpen(false); setPending({}); load(); }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// Revisión antes de cerrar: diferencias contra el sistema
// ──────────────────────────────────────────────
function ReviewDialog({ open, countId, pendingCount, onClose, onClosed }: {
  open: boolean; countId: number; pendingCount: number; onClose: () => void; onClosed: () => void;
}) {
  const [summary, setSummary] = useState<StockCountPreview | null>(null);
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    stockCountsApi.summary(countId).then(r => setSummary(r.summary)).catch(err => {
      toast.error(errMsg(err, 'No se pudo calcular el resumen'));
      onClose();
    });
  }, [open, countId, onClose]);

  async function closeCount() {
    setClosing(true);
    try {
      const { summary: s } = await stockCountsApi.close(countId, notes.trim() || undefined);
      toast.success(s.differences === 0
        ? 'Conteo cerrado: coincidía todo'
        : `Conteo cerrado: ${s.differences} ${s.differences === 1 ? 'insumo corregido' : 'insumos corregidos'}`);
      onClosed();
    } catch (err) {
      toast.error(errMsg(err, 'No se pudo cerrar el conteo'));
    } finally {
      setClosing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar y cerrar</DialogTitle>
          <DialogDescription>Lo contado contra lo que dice el sistema ahora. Al cerrar, el stock queda como lo contaste.</DialogDescription>
        </DialogHeader>
        {summary === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 text-sm">
            {pendingCount > 0 && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                Hay {pendingCount} {pendingCount === 1 ? 'número' : 'números'} sin enviar (sin conexión). Esperá a que se envíen antes de cerrar.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Contados" value={`${summary.countedLines}/${summary.totalLines}`} />
              <Stat label="Diferencias" value={String(summary.differences.length)} />
              <Stat label="Valor" value={formatMoney(summary.differenceValue)}
                tone={summary.differenceValue < 0 ? 'text-rose-300' : summary.differenceValue > 0 ? 'text-emerald-300' : undefined} />
            </div>
            {summary.uncounted > 0 && (
              <p className="text-xs text-muted-foreground">{summary.uncounted} sin contar: quedan como están.</p>
            )}
            {summary.differences.length > 0 && (
              <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto">
                {summary.differences.map(d => (
                  <li key={d.lineId} className="flex items-start gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{d.itemName}</span>
                      <span className="block text-xs text-muted-foreground">
                        sistema {fmtQty(d.expectedQty)} → contado {fmtQty(d.countedQty)} {d.unit}
                      </span>
                      {d.reason && <span className="block text-xs text-muted-foreground">{d.reason}</span>}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className={cn('font-semibold', d.difference < 0 ? 'text-rose-300' : 'text-emerald-300')}>
                        {fmtQty(d.difference, true)} {d.unit}
                      </span>
                      <span className="block text-xs text-muted-foreground">{formatMoney(d.value)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Label htmlFor="countNotes">Nota del conteo (opcional)</Label>
              <Textarea id="countNotes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej.: conteo del domingo, faltó revisar el freezer" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={closing}>Seguir contando</Button>
          <Button onClick={closeCount} disabled={closing || summary === null || pendingCount > 0}>
            {closing && <Loader2 className="h-4 w-4 animate-spin" />}
            Cerrar conteo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

// ──────────────────────────────────────────────
// Conteo cerrado o descartado: solo lectura
// ──────────────────────────────────────────────
function ClosedCount({ count, onBack }: { count: StockCount; onBack: () => void }) {
  const [onlyDiffs, setOnlyDiffs] = useState(count.status === 'CLOSED');
  const rows = count.lines.filter(l => !onlyDiffs || (l.difference !== null && Math.abs(l.difference) >= 0.0001));
  const total = count.lines.reduce((s, l) => s + (l.difference ?? 0) * Number(l.unitCost ?? 0), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-bold">{count.areaName}</p>
          <p className="text-xs text-muted-foreground">
            {STATUS_LABEL[count.status]} {formatDateTime(count.closedAt)}
            {count.closedByName && ` · ${count.closedByName}`}
          </p>
        </div>
        {count.status === 'CLOSED' && (
          <span className={cn('text-sm font-semibold tabular-nums', total < 0 ? 'text-rose-300' : total > 0 ? 'text-emerald-300' : 'text-muted-foreground')}>
            {formatMoney(total)}
          </span>
        )}
      </div>
      {count.notes && <p className="mb-3 rounded-xl bg-white/[0.04] p-3 text-sm">{count.notes}</p>}
      <div className="mb-3 flex gap-1.5">
        {[[true, 'Solo diferencias'], [false, 'Todo']].map(([v, label]) => (
          <button key={String(v)} type="button" onClick={() => setOnlyDiffs(v as boolean)}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-medium',
              onlyDiffs === v ? 'border-brand-500/50 bg-brand-500/10 text-brand-400' : 'border-border text-muted-foreground')}>
            {label as string}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
          {onlyDiffs ? 'Sin diferencias: el stock coincidía' : 'Sin líneas'}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card px-3 text-sm">
          {rows.map(l => (
            <li key={l.id} className="flex items-start gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{l.itemName}</span>
                <span className="block text-xs text-muted-foreground">
                  {l.countedQty === null
                    ? 'sin contar'
                    : l.expectedQty !== null
                      ? `sistema ${fmtQty(l.expectedQty)} → contado ${fmtQty(l.countedQty)} ${l.unit}`
                      : `contado ${fmtQty(l.countedQty)} ${l.unit}`}
                  {l.countedByName && ` · ${l.countedByName}`}
                </span>
                {l.reason && <span className="block text-xs text-muted-foreground">{l.reason}</span>}
              </span>
              {l.difference !== null && Math.abs(l.difference) >= 0.0001 && (
                <span className="shrink-0 text-right tabular-nums">
                  <span className={cn('font-semibold', l.difference < 0 ? 'text-rose-300' : 'text-emerald-300')}>
                    {fmtQty(l.difference, true)} {l.unit}
                  </span>
                  <span className="block text-xs text-muted-foreground">{formatMoney(l.difference * Number(l.unitCost ?? 0))}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
