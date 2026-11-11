// ──────────────────────────────────────────────
// StaffHours.tsx — Horarios del personal (permiso "Registrar horarios")
//
// - Ahora: quién está trabajando, con "Marcar entrada" / "Marcar salida".
// - Semana (lunes a domingo): horas de cada uno × valor por hora = a pagar.
// - Turnos a mano (se olvidaron de marcar) y correcciones, siempre con motivo.
// Las horas se muestran en hora del local, aunque el dispositivo tenga otra zona.
// ──────────────────────────────────────────────
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Clock, Download, Edit, Loader2, LogIn, LogOut, Plus, Trash2, AlertTriangle,
} from 'lucide-react';
import { staffShiftsApi, ApiError, type StaffWeek, type StaffWeekRow, type StaffWeekShift } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { useTick } from '../hooks/useTables';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const TZ = 'America/Argentina/Buenos_Aires';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** Día del local "YYYY-MM-DD" de un instante. */
const localDay = (d: Date | string) => dayFmt.format(new Date(d));
const localTime = (d: Date | string) => timeFmt.format(new Date(d));
/** Suma días a "YYYY-MM-DD" (aritmética de calendario, sin horas). */
function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
const dayLabel = (day: string) => weekdayFmt.format(new Date(`${day}T12:00:00Z`));
function hoursLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

function useStaffWeek(day: string) {
  const [week, setWeek] = useState<StaffWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setWeek(await staffShiftsApi.week(day)); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los horarios'); }
    finally { setLoading(false); }
  }, [day]);
  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  useResync(refresh);
  useEffect(() => {
    const socket = getSocket();
    const on = () => { refresh(); };
    socket.on(SocketEvents.STAFF_SHIFTS_CHANGED, on);
    socket.on(SocketEvents.STAFF_CHANGED, on);
    return () => {
      socket.off(SocketEvents.STAFF_SHIFTS_CHANGED, on);
      socket.off(SocketEvents.STAFF_CHANGED, on);
    };
  }, [refresh]);
  return { week, loading, refresh };
}

type Editing =
  | { kind: 'create'; staffId?: number }
  | { kind: 'edit'; shift: StaffWeekShift; staffName: string };

export function StaffHours() {
  useTick(30_000); // "trabajando hace 2 h 10 min" se actualiza solo
  const today = localDay(new Date());
  const [day, setDay] = useState(today);
  const { week, loading, refresh } = useStaffWeek(day);
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<{ shift: StaffWeekShift; staffName: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const isThisWeek = week ? today >= week.weekStart && today <= week.weekEnd : true;
  const working = useMemo(() => (week?.staff ?? []).filter(s => s.active), [week]);

  async function clock(member: StaffWeekRow) {
    setBusy(member.id);
    try {
      if (member.openShift) {
        await staffShiftsApi.clockOut(member.id);
        toast.success(`Salida de ${member.name} a las ${localTime(new Date())}`);
      } else {
        await staffShiftsApi.clockIn(member.id);
        toast.success(`Entrada de ${member.name} a las ${localTime(new Date())}`);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo marcar');
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    try { await staffShiftsApi.downloadCsv(day); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudo descargar'); }
  }

  if (loading && !week) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Encabezado */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Equipo</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Horarios</h2>
          <p className="text-sm text-muted-foreground">Entrada y salida de cada uno; las horas de la semana × el valor por hora es lo que se paga.</p>
        </div>
        <Button onClick={() => setEditing({ kind: 'create' })}>
          <Plus className="h-4 w-4" />
          Cargar turno a mano
        </Button>
      </div>

      {/* Ahora */}
      {isThisWeek && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">Ahora</h3>
          {working.length === 0 ? (
            <p className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">No hay personal activo. Cargalo en la pestaña Fichas.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {working.map(m => {
                const inside = !!m.openShift;
                const since = m.openShift ? Math.floor((Date.now() - new Date(m.openShift.clockIn).getTime()) / 60_000) : 0;
                return (
                  <div key={m.id} className={cn('glass flex items-center justify-between gap-3 rounded-2xl p-4', inside && 'border border-emerald-400/30')}>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className={cn('text-xs', inside ? 'text-emerald-300' : 'text-muted-foreground')}>
                        {inside
                          ? `Trabajando desde las ${localTime(m.openShift!.clockIn)} · ${hoursLabel(since)}`
                          : 'Fuera de turno'}
                      </p>
                    </div>
                    <Button size="sm" variant={inside ? 'outline' : 'default'} disabled={busy === m.id} onClick={() => clock(m)}>
                      {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : inside ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                      {inside ? 'Marcar salida' : 'Marcar entrada'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Semana */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setDay(d => addDays(d, -7))} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="px-2 text-sm font-semibold">
              {week ? `Semana del ${dayLabel(week.weekStart)} al ${dayLabel(week.weekEnd)}` : ''}
            </span>
            <Button variant="outline" size="icon" onClick={() => setDay(d => addDays(d, 7))} disabled={isThisWeek} aria-label="Semana siguiente"><ChevronRight className="h-4 w-4" /></Button>
            {!isThisWeek && <Button variant="ghost" size="sm" onClick={() => setDay(today)}>Esta semana</Button>}
          </div>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="h-4 w-4" />
            Descargar CSV
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Empleado</th>
                <th className="px-3 py-2.5 text-right font-medium">Horas</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Valor hora</th>
                <th className="px-3 py-2.5 text-right font-medium">A pagar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(week?.staff ?? []).length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Sin personal para esta semana</td></tr>
              )}
              {(week?.staff ?? []).map(m => {
                const open = expanded.has(m.id);
                return (
                  <Fragment key={m.id}>
                    <tr className="cursor-pointer hover:bg-white/[0.025]" onClick={() => setExpanded(s => {
                      const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n;
                    })}>
                      <td className="px-3 py-3">
                        <span className="font-medium">{m.name}</span>
                        {!m.active && <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span>}
                        <span className="ml-2 text-xs text-muted-foreground">{m.shifts.length} {m.shifts.length === 1 ? 'turno' : 'turnos'}</span>
                        {m.missingRate && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300" title="Cargá el valor por hora en la pestaña Fichas">
                            <AlertTriangle className="h-3 w-3" /> falta el valor por hora
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{hoursLabel(m.minutes)}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {m.hourlyRate !== null ? formatMoney(m.hourlyRate) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatMoney(m.amount)}</td>
                    </tr>
                    {open && (
                      <tr className="bg-white/[0.02]">
                        <td colSpan={4} className="px-3 py-3">
                          {m.shifts.length === 0 && <p className="text-xs text-muted-foreground">Sin turnos esta semana.</p>}
                          <ul className="space-y-1.5">
                            {m.shifts.map(s => (
                              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="tabular-nums">
                                  <span className="inline-block w-24 capitalize text-muted-foreground">{dayLabel(s.day)}</span>
                                  {localTime(s.clockIn)} a {s.clockOut ? localTime(s.clockOut) : <span className="text-emerald-300">sigue trabajando</span>}
                                  {s.clockOut && localDay(s.clockOut) !== s.day && <span className="text-muted-foreground"> (del día siguiente)</span>}
                                  {s.clockOut && <span className="ml-2 text-muted-foreground">· {hoursLabel(s.minutes)} · {formatMoney(s.amount)}</span>}
                                  {s.note && <span className="ml-2 italic text-muted-foreground">“{s.note}”</span>}
                                </span>
                                <span className="flex gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'edit', shift: s, staffName: m.name })}>
                                    <Edit className="h-3.5 w-3.5" /> Corregir
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setDeleting({ shift: s, staffName: m.name })}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </span>
                              </li>
                            ))}
                          </ul>
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing({ kind: 'create', staffId: m.id })}>
                            <Plus className="h-3.5 w-3.5" /> Agregar turno de {m.name}
                          </Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {week && week.staff.length > 0 && (
              <tfoot className="border-t border-border bg-white/[0.04] font-semibold">
                <tr>
                  <td className="px-3 py-3">Total de la semana</td>
                  <td className="px-3 py-3 text-right tabular-nums">{hoursLabel(week.totals.minutes)}</td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-3 text-right tabular-nums">{formatMoney(week.totals.amount)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Un turno que pasa la medianoche cuenta para el día en que empezó. Los turnos sin salida no suman hasta que se marque.
        </p>
      </section>

      {editing && (
        <ShiftDialog editing={editing} staff={week?.staff ?? []} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteShiftDialog target={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

/** Cargar un turno a mano o corregir uno: día, entrada, salida (opcional), nota y motivo. */
function ShiftDialog({ editing, staff, onClose }: { editing: Editing; staff: StaffWeekRow[]; onClose: () => void }) {
  const isEdit = editing.kind === 'edit';
  const shift = isEdit ? editing.shift : null;
  const [staffId, setStaffId] = useState<string>(
    editing.kind === 'create' && editing.staffId ? String(editing.staffId) : '',
  );
  const [day, setDay] = useState(shift ? shift.day : localDay(new Date()));
  const [from, setFrom] = useState(shift ? localTime(shift.clockIn) : '');
  const [to, setTo] = useState(shift?.clockOut ? localTime(shift.clockOut) : '');
  const [stillWorking, setStillWorking] = useState(isEdit && !shift?.clockOut);
  const [note, setNote] = useState(shift?.note ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const crossesMidnight = !stillWorking && from && to && to <= from;

  async function save() {
    if (!isEdit && !staffId) { toast.error('Elegí a quién le cargás el turno'); return; }
    if (!from) { toast.error('Poné la hora de entrada'); return; }
    if (!stillWorking && !to) { toast.error('Poné la hora de salida, o marcá "Sigue trabajando"'); return; }
    if (reason.trim().length < 3) { toast.error('Escribí el motivo'); return; }
    setSaving(true);
    try {
      const body = { day, from, to: stillWorking ? null : to, note: note.trim() || null, reason: reason.trim() };
      if (isEdit) await staffShiftsApi.update(shift!.id, body);
      else await staffShiftsApi.create({ ...body, staffMemberId: Number(staffId) });
      toast.success(isEdit ? 'Turno corregido' : 'Turno cargado');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Corregir turno de ${editing.staffName}` : 'Cargar turno a mano'}</DialogTitle>
          <DialogDescription>Para cuando se olvidaron de marcar, o para corregir una hora. Queda registrado en Auditoría.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="shStaff">Empleado *</Label>
              <Select id="shStaff" value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={saving}>
                <option value="">Elegí…</option>
                {staff.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-2 sm:col-span-1">
              <Label htmlFor="shDay">Día de entrada *</Label>
              <Input id="shDay" type="date" value={day} max={localDay(new Date())} onChange={(e) => setDay(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shFrom">Entrada *</Label>
              <Input id="shFrom" type="time" value={from} onChange={(e) => setFrom(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shTo">Salida</Label>
              <Input id="shTo" type="time" value={to} onChange={(e) => setTo(e.target.value)} disabled={saving || stillWorking} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={stillWorking} onChange={(e) => setStillWorking(e.target.checked)} disabled={saving} />
            Sigue trabajando (todavía no salió)
          </label>
          {crossesMidnight && (
            <p className="text-xs text-amber-300">La salida es del día siguiente (el turno pasa la medianoche).</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="shNote">Nota</Label>
            <Input id="shNote" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="Opcional" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shReason">Motivo *</Label>
            <Input id="shReason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving}
              placeholder={isEdit ? 'Ej.: marcó tarde la salida' : 'Ej.: se olvidó de marcar'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'Guardar' : 'Cargar turno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteShiftDialog({ target, onClose }: { target: { shift: StaffWeekShift; staffName: string }; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const s = target.shift;
  async function remove() {
    if (reason.trim().length < 3) { toast.error('Escribí el motivo'); return; }
    setSaving(true);
    try {
      await staffShiftsApi.remove(s.id, reason.trim());
      toast.success('Turno borrado');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo borrar');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Borrar el turno de {target.staffName}?</DialogTitle>
          <DialogDescription>
            {dayLabel(s.day)}, {localTime(s.clockIn)} a {s.clockOut ? localTime(s.clockOut) : 'sin salida'}. Deja de sumar horas y queda registrado en Auditoría.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delReason">Motivo *</Label>
          <Input id="delReason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} placeholder="Ej.: cargado dos veces" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="destructive" onClick={remove} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Borrar turno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
