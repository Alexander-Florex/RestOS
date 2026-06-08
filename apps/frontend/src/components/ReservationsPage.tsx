// ──────────────────────────────────────────────
// ReservationsPage.tsx — Gestión de reservas
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Calendar, Clock, Users, Phone, Loader2, ChevronLeft, ChevronRight,
  Check, X, UserCheck, BookmarkX, Edit, Trash2, AlertCircle,
} from 'lucide-react';
import { useReservations } from '../hooks/useReservations';
import { useTables } from '../hooks/useTables';
import {
  reservationsApi, type Reservation, type ReservationStatus, ApiError,
} from '../lib/api';
import {
  RESERVATION_STATUS_LABEL, RESERVATION_STATUS_STYLE,
  formatTime, localDateString, toDateTimeLocalInput, minutesUntil,
} from '../lib/reservation-helpers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

interface FormState {
  customerName: string;
  customerPhone: string;
  partySize: string;
  reservedAt: string; // datetime-local
  duration: string;
  tableId: string; // '' o el id como string
  notes: string;
  status: ReservationStatus;
}

const EMPTY_FORM: FormState = {
  customerName: '',
  customerPhone: '',
  partySize: '2',
  reservedAt: '',
  duration: '90',
  tableId: '',
  notes: '',
  status: 'CONFIRMED',
};

export function ReservationsPage() {
  // Día seleccionado (default: hoy)
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dayRange = useMemo(() => {
    const from = new Date(selectedDate);
    const to = new Date(selectedDate);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [selectedDate]);

  const { reservations, loading } = useReservations(dayRange);
  const { tables } = useTables();

  const [filter, setFilter] = useState<ReservationStatus | 'ALL'>('ALL');
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    return reservations
      .filter(r => filter === 'ALL' ? true : r.status === filter)
      .sort((a, b) => new Date(a.reservedAt).getTime() - new Date(b.reservedAt).getTime());
  }, [reservations, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: reservations.length };
    for (const r of reservations) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [reservations]);

  const isToday = localDateString(selectedDate) === localDateString(new Date());

  function shiftDay(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  }

  function openCreate() {
    const defaultTime = new Date();
    defaultTime.setHours(20, 0, 0, 0);
    setForm({ ...EMPTY_FORM, reservedAt: toDateTimeLocalInput(defaultTime) });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(r: Reservation) {
    setForm({
      customerName: r.customerName,
      customerPhone: r.customerPhone ?? '',
      partySize: String(r.partySize),
      reservedAt: toDateTimeLocalInput(r.reservedAt),
      duration: String(r.duration),
      tableId: r.tableId ? String(r.tableId) : '',
      notes: r.notes ?? '',
      status: r.status,
    });
    setEditing(r);
    setCreating(false);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit() {
    if (!form.customerName.trim() || !form.reservedAt) {
      toast.error('Nombre del cliente y fecha/hora son obligatorios');
      return;
    }
    const partySize = Number(form.partySize);
    if (Number.isNaN(partySize) || partySize < 1) {
      toast.error('La cantidad de comensales debe ser ≥ 1');
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || null,
        partySize,
        reservedAt: new Date(form.reservedAt).toISOString(),
        duration: Number(form.duration) || 90,
        tableId: form.tableId ? Number(form.tableId) : null,
        notes: form.notes.trim() || null,
        status: form.status,
      };
      if (editing) {
        await reservationsApi.update(editing.id, data);
        toast.success('Reserva actualizada');
      } else {
        await reservationsApi.create(data);
        toast.success(`Reserva creada para ${data.customerName}`);
      }
      closeForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(fn: () => Promise<unknown>, successMsg: string) {
    try {
      await fn();
      toast.success(successMsg);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Reservas</h2>
          <p className="text-sm text-muted-foreground">
            {reservations.length} {reservations.length === 1 ? 'reserva' : 'reservas'} en este día
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva reserva
        </Button>
      </div>

      {/* Selector de día */}
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-border bg-card p-3">
        <Button variant="ghost" size="icon" onClick={() => shiftDay(-1)} aria-label="Día anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {isToday ? 'Hoy' : ''}
          </p>
          <p className="text-base font-semibold capitalize">
            {selectedDate.toLocaleDateString('es-AR', {
              weekday: 'long', day: '2-digit', month: 'long',
            })}
          </p>
          {!isToday && (
            <button
              onClick={() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                setSelectedDate(d);
              }}
              className="mt-1 text-[10px] uppercase tracking-wider text-emerald-400 hover:underline"
            >
              Volver a hoy
            </button>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => shiftDay(1)} aria-label="Día siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Filtros por estado */}
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="Todas" count={counts.ALL} />
        {(['CONFIRMED', 'PENDING', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as ReservationStatus[]).map(s => {
          const count = counts[s] ?? 0;
          if (count === 0 && filter !== s) return null;
          const style = RESERVATION_STATUS_STYLE[s];
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === s
                  ? `${style.border} ${style.bg} ${style.text}`
                  : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
              {RESERVATION_STATUS_LABEL[s]}
              <span className="rounded-full bg-background/50 px-1.5 text-[10px] tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Listado timeline */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No hay reservas para este día con este filtro
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const style = RESERVATION_STATUS_STYLE[r.status];
            const table = r.tableId ? tables.find(t => t.id === r.tableId) : null;
            const minsUntil = minutesUntil(r.reservedAt);
            const upcoming = (r.status === 'CONFIRMED' || r.status === 'PENDING') && minsUntil >= 0 && minsUntil <= 30;
            const isActive = r.status === 'CONFIRMED' || r.status === 'PENDING' || r.status === 'SEATED';

            return (
              <div
                key={r.id}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors md:flex-row md:items-center',
                  upcoming ? 'border-amber-500/40 bg-amber-500/5' : 'border-border',
                  !isActive && 'opacity-60'
                )}
              >
                {/* Hora + estado */}
                <div className="flex shrink-0 items-center gap-3 md:w-44">
                  <div className="flex h-12 w-14 flex-col items-center justify-center rounded-xl border border-border bg-background">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Hora</p>
                    <p className="text-sm font-bold tabular-nums">{formatTime(r.reservedAt)}</p>
                  </div>
                  <div>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      style.text, style.bg
                    )}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                      {RESERVATION_STATUS_LABEL[r.status]}
                    </span>
                    {upcoming && (
                      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
                        En {minsUntil} min
                      </p>
                    )}
                  </div>
                </div>

                {/* Cliente + party + tel + notas */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{r.customerName}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {r.partySize} {r.partySize === 1 ? 'persona' : 'personas'}
                    </span>
                    {r.customerPhone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {r.customerPhone}
                      </span>
                    )}
                    {table && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Mesa N° {table.number}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {r.duration} min
                    </span>
                  </div>
                  {r.notes && (
                    <p className="mt-1 text-xs italic text-muted-foreground truncate">"{r.notes}"</p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex flex-wrap items-center gap-1">
                  {r.status === 'CONFIRMED' && r.tableId && (
                    <>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => runAction(
                          () => reservationsApi.markTableReserved(r.id),
                          `Mesa ${table?.number} marcada como reservada`
                        )}
                        title="Reservar la mesa ahora"
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        Reservar mesa
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => runAction(
                          () => reservationsApi.seat(r.id),
                          `Comensales sentados en mesa ${table?.number}`
                        )}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Sentar
                      </Button>
                    </>
                  )}
                  {r.status === 'CONFIRMED' && !r.tableId && (
                    <span className="rounded-md border border-dashed border-amber-500/40 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-400">
                      Asignar mesa
                    </span>
                  )}
                  {(r.status === 'CONFIRMED' || r.status === 'PENDING' || r.status === 'SEATED') && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => runAction(
                        () => reservationsApi.cancel(r.id),
                        'Reserva cancelada'
                      )}
                      title="Cancelar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  {(r.status === 'CONFIRMED' || r.status === 'PENDING') && minsUntil < 0 && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => runAction(
                        () => reservationsApi.noShow(r.id),
                        'Marcada como no-show'
                      )}
                      title="No vinieron"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <BookmarkX className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Editar">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => {
                      if (!window.confirm(`¿Eliminar la reserva de "${r.customerName}"?`)) return;
                      runAction(() => reservationsApi.remove(r.id), 'Reserva eliminada');
                    }}
                    title="Eliminar"
                    className="text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal alta / edición */}
      <Dialog open={creating || editing !== null} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar reserva' : 'Nueva reserva'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Modificá los datos del cliente y la mesa' : 'Cargá los datos del cliente'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Cliente *</Label>
              <Input
                id="customerName" value={form.customerName} autoFocus
                onChange={(e) => setForm(f => ({ ...f, customerName: e.target.value }))}
                disabled={submitting} placeholder="Familia Pérez"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="customerPhone">Teléfono</Label>
                <Input
                  id="customerPhone" type="tel" value={form.customerPhone}
                  onChange={(e) => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                  disabled={submitting} placeholder="+54 11 ..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="partySize">Comensales *</Label>
                <Input
                  id="partySize" type="number" min="1" inputMode="numeric"
                  value={form.partySize}
                  onChange={(e) => setForm(f => ({ ...f, partySize: e.target.value }))}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="reservedAt">Fecha y hora *</Label>
                <Input
                  id="reservedAt" type="datetime-local"
                  value={form.reservedAt}
                  onChange={(e) => setForm(f => ({ ...f, reservedAt: e.target.value }))}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duración (min)</Label>
                <Input
                  id="duration" type="number" min="15" inputMode="numeric"
                  value={form.duration}
                  onChange={(e) => setForm(f => ({ ...f, duration: e.target.value }))}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tableId">Mesa asignada</Label>
              <Select
                id="tableId"
                value={form.tableId}
                onChange={(e) => setForm(f => ({ ...f, tableId: e.target.value }))}
                disabled={submitting}
              >
                <option value="">Sin asignar mesa</option>
                {tables.map(t => (
                  <option key={t.id} value={t.id}>
                    Mesa N° {t.number} (cap. {t.capacity})
                  </option>
                ))}
              </Select>
              {form.tableId && form.partySize && (() => {
                const t = tables.find(t => String(t.id) === form.tableId);
                const ps = Number(form.partySize);
                if (t && ps > t.capacity) {
                  return (
                    <p className="flex items-center gap-1 text-xs text-amber-400">
                      <AlertCircle className="h-3 w-3" />
                      La mesa tiene capacidad para {t.capacity}; van {ps}
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes" value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                disabled={submitting} placeholder="Cumpleaños, mesa cerca de la ventana..."
              />
            </div>

            {editing && (
              <div className="space-y-2">
                <Label htmlFor="status">Estado</Label>
                <Select
                  id="status" value={form.status}
                  onChange={(e) => setForm(f => ({ ...f, status: e.target.value as ReservationStatus }))}
                  disabled={submitting}
                >
                  <option value="PENDING">Pendiente</option>
                  <option value="CONFIRMED">Confirmada</option>
                  <option value="SEATED">En mesa</option>
                  <option value="COMPLETED">Completada</option>
                  <option value="CANCELLED">Cancelada</option>
                  <option value="NO_SHOW">No vino</option>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? <><Check className="h-4 w-4" /> Guardar</> : <><Plus className="h-4 w-4" /> Crear</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count,
}: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
          : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      <span className={cn(
        'rounded-full px-1.5 text-[10px] tabular-nums',
        active ? 'bg-emerald-500/20' : 'bg-background/50'
      )}>{count}</span>
    </button>
  );
}
