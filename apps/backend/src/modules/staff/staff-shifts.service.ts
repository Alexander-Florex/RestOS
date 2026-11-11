// ──────────────────────────────────────────────
// staff-shifts.service.ts — Horarios del personal
//
// El administrador marca la entrada y la salida de cada empleado (o carga/corrige
// el turno a mano, con motivo y auditoría). Las horas se suman por semana, de lunes
// a domingo en hora del local; un turno que pasa la medianoche cuenta para el día
// en que empezó. Pago = horas × valor por hora (el que tenía al entrar).
// ──────────────────────────────────────────────
import { Prisma, type StaffShift } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { addDays, formatLocalDateTime, localDayKey, startOfLocalDay, weekStartOf, type DayKey } from '../../lib/time.js';

/** Un turno más largo que esto casi seguro es un olvido de marcar la salida. */
export const MAX_SHIFT_HOURS = 20;
const HOUR_MS = 3_600_000;

function emitChanged(restaurantId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.STAFF_SHIFTS_CHANGED, {});
}

async function getMember(restaurantId: number, staffMemberId: number) {
  const m = await prisma.staffMember.findFirst({ where: { id: staffMemberId, restaurantId } });
  if (!m) throw HttpError.notFound('Empleado no encontrado');
  return m;
}

async function getShift(restaurantId: number, id: number) {
  const s = await prisma.staffShift.findFirst({ where: { id, restaurantId } });
  if (!s) throw HttpError.notFound('Turno no encontrado');
  return s;
}

function checkTimes(clockIn: Date, clockOut: Date | null) {
  const now = Date.now();
  if (clockIn.getTime() > now + 5 * 60_000) throw HttpError.badRequest('La entrada no puede ser en el futuro');
  if (clockOut) {
    if (clockOut.getTime() <= clockIn.getTime()) throw HttpError.badRequest('La salida tiene que ser después de la entrada');
    if (clockOut.getTime() > now + 5 * 60_000) throw HttpError.badRequest('La salida no puede ser en el futuro');
    if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_HOURS * HOUR_MS) {
      throw HttpError.badRequest(`Un turno no puede durar más de ${MAX_SHIFT_HOURS} horas. Revisá la entrada y la salida.`);
    }
  }
}

/** Dos turnos de la misma persona no pueden pisarse. */
async function checkOverlap(staffMemberId: number, clockIn: Date, clockOut: Date | null, exceptId?: number) {
  const other = await prisma.staffShift.findFirst({
    where: {
      staffMemberId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      // Sin salida (turno en curso): choca con cualquier turno que termine después de la entrada
      ...(clockOut ? { clockIn: { lt: clockOut } } : {}),
      OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
    },
  });
  if (other) {
    throw HttpError.conflict(
      `Se superpone con otro turno (${formatLocalDateTime(other.clockIn).slice(0, 16)}` +
      `${other.clockOut ? ` a ${formatLocalDateTime(other.clockOut).slice(11, 16)}` : ', sin salida'}).`,
    );
  }
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Pago de un turno en centavos: horas × valor por hora, redondeado al centavo. */
function shiftPayCents(s: Pick<StaffShift, 'clockIn' | 'clockOut' | 'hourlyRate'>): number {
  if (!s.clockOut || s.hourlyRate === null) return 0;
  const minutes = Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60_000);
  return Math.round((minutes * Math.round(Number(s.hourlyRate) * 100)) / 60);
}

export interface WeekSummary {
  weekStart: DayKey;
  weekEnd: DayKey;
  staff: Array<{
    id: number;
    name: string;
    role: string;
    active: boolean;
    hourlyRate: number | null;
    /** Turno en curso (si está trabajando ahora) */
    openShift: { id: number; clockIn: string } | null;
    minutes: number;
    amount: number;
    /** Hay turnos sin valor por hora (no suman al pago) */
    missingRate: boolean;
    shifts: Array<{
      id: number; day: DayKey; clockIn: string; clockOut: string | null;
      minutes: number; amount: number; hourlyRate: number | null; note: string | null;
    }>;
  }>;
  totals: { minutes: number; amount: number };
}

export const staffShiftsService = {
  /** Marca la entrada ahora. Un solo turno abierto por persona. */
  async clockIn(restaurantId: number, staffMemberId: number, userId: number | null) {
    const member = await getMember(restaurantId, staffMemberId);
    if (!member.active) throw HttpError.badRequest('El empleado está desactivado');
    const now = new Date();
    await checkOverlap(staffMemberId, now, null);
    try {
      const shift = await prisma.staffShift.create({
        data: {
          restaurantId, staffMemberId, clockIn: now, openKey: staffMemberId,
          hourlyRate: member.hourlyRate, recordedById: userId,
        },
      });
      emitChanged(restaurantId);
      return shift;
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict(`${member.name} ya tiene la entrada marcada`);
      throw err;
    }
  },

  /** Marca la salida ahora del turno abierto. */
  async clockOut(restaurantId: number, staffMemberId: number) {
    const member = await getMember(restaurantId, staffMemberId);
    const open = await prisma.staffShift.findFirst({ where: { restaurantId, openKey: staffMemberId } });
    if (!open) throw HttpError.conflict(`${member.name} no tiene la entrada marcada`);
    const now = new Date();
    if (now.getTime() - open.clockIn.getTime() > MAX_SHIFT_HOURS * HOUR_MS) {
      throw HttpError.badRequest(
        `La entrada es de hace más de ${MAX_SHIFT_HOURS} horas (${formatLocalDateTime(open.clockIn).slice(0, 16)}): ` +
        'seguramente se olvidaron de marcar la salida. Corregí el turno a mano.',
      );
    }
    // Solo cierra si sigue abierto (dos "salida" a la vez no cierran dos veces)
    const closed = await prisma.staffShift.updateMany({
      where: { id: open.id, openKey: staffMemberId },
      data: { clockOut: now, openKey: null },
    });
    if (closed.count !== 1) throw HttpError.conflict(`La salida de ${member.name} ya se marcó`);
    emitChanged(restaurantId);
    return prisma.staffShift.findUniqueOrThrow({ where: { id: open.id } });
  },

  /** Carga un turno a mano (se olvidaron de marcar). Con motivo y auditoría. */
  async create(restaurantId: number, input: {
    staffMemberId: number; clockIn: Date; clockOut: Date | null; note?: string | null; reason: string; userId: number | null;
  }) {
    const member = await getMember(restaurantId, input.staffMemberId);
    checkTimes(input.clockIn, input.clockOut);
    await checkOverlap(member.id, input.clockIn, input.clockOut);
    try {
      const shift = await prisma.$transaction(async (tx) => {
        const s = await tx.staffShift.create({
          data: {
            restaurantId, staffMemberId: member.id, clockIn: input.clockIn, clockOut: input.clockOut,
            openKey: input.clockOut ? null : member.id,
            hourlyRate: member.hourlyRate, note: input.note ?? null, recordedById: input.userId,
          },
        });
        await audit(tx, {
          restaurantId, action: 'staff.shift.create', entity: 'StaffShift', entityId: s.id,
          after: { staff: member.name, clockIn: s.clockIn, clockOut: s.clockOut, note: s.note }, reason: input.reason,
        });
        return s;
      });
      emitChanged(restaurantId);
      return shift;
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict(`${member.name} ya tiene un turno sin salida`);
      throw err;
    }
  },

  /** Corrige entrada, salida o nota de un turno. Con motivo y auditoría. */
  async update(restaurantId: number, id: number, input: {
    clockIn?: Date; clockOut?: Date | null; note?: string | null; reason: string;
  }) {
    const current = await getShift(restaurantId, id);
    const member = await getMember(restaurantId, current.staffMemberId);
    const clockIn = input.clockIn ?? current.clockIn;
    const clockOut = input.clockOut !== undefined ? input.clockOut : current.clockOut;
    checkTimes(clockIn, clockOut);
    await checkOverlap(member.id, clockIn, clockOut, id);
    try {
      const shift = await prisma.$transaction(async (tx) => {
        const s = await tx.staffShift.update({
          where: { id },
          data: {
            clockIn, clockOut, openKey: clockOut ? null : member.id,
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
        });
        await audit(tx, {
          restaurantId, action: 'staff.shift.update', entity: 'StaffShift', entityId: id,
          before: { staff: member.name, clockIn: current.clockIn, clockOut: current.clockOut, note: current.note },
          after: { clockIn: s.clockIn, clockOut: s.clockOut, note: s.note },
          reason: input.reason,
        });
        return s;
      });
      emitChanged(restaurantId);
      return shift;
    } catch (err) {
      if (isUniqueViolation(err)) throw HttpError.conflict(`${member.name} ya tiene otro turno sin salida`);
      throw err;
    }
  },

  async remove(restaurantId: number, id: number, reason: string) {
    const current = await getShift(restaurantId, id);
    const member = await getMember(restaurantId, current.staffMemberId);
    await prisma.$transaction(async (tx) => {
      await tx.staffShift.delete({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'staff.shift.delete', entity: 'StaffShift', entityId: id,
        before: { staff: member.name, clockIn: current.clockIn, clockOut: current.clockOut, note: current.note },
        reason,
      });
    });
    emitChanged(restaurantId);
  },

  /** Horas y pago de la semana (lunes a domingo) de todo el personal. */
  async week(restaurantId: number, anyDay: DayKey = localDayKey(new Date())): Promise<WeekSummary> {
    const weekStart = weekStartOf(anyDay);
    const weekEnd = addDays(weekStart, 6);
    const from = startOfLocalDay(weekStart);
    const to = startOfLocalDay(addDays(weekStart, 7));

    const [members, shifts, open] = await Promise.all([
      prisma.staffMember.findMany({ where: { restaurantId }, orderBy: { name: 'asc' } }),
      prisma.staffShift.findMany({
        where: { restaurantId, clockIn: { gte: from, lt: to } },
        orderBy: { clockIn: 'asc' },
      }),
      prisma.staffShift.findMany({ where: { restaurantId, openKey: { not: null } } }),
    ]);

    const openBy = new Map(open.map(s => [s.staffMemberId, s]));
    let totalMinutes = 0;
    let totalCents = 0;
    const staff: WeekSummary['staff'] = [];
    for (const m of members) {
      const mine = shifts.filter(s => s.staffMemberId === m.id);
      // Inactivos sin turnos esa semana no aparecen
      if (!m.active && mine.length === 0) continue;
      let minutes = 0;
      let cents = 0;
      let missingRate = false;
      const rows = mine.map(s => {
        const min = s.clockOut ? Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60_000) : 0;
        const c = shiftPayCents(s);
        if (s.clockOut && s.hourlyRate === null) missingRate = true;
        minutes += min;
        cents += c;
        return {
          id: s.id, day: localDayKey(s.clockIn), clockIn: s.clockIn.toISOString(),
          clockOut: s.clockOut?.toISOString() ?? null, minutes: min, amount: c / 100,
          hourlyRate: s.hourlyRate === null ? null : Number(s.hourlyRate), note: s.note,
        };
      });
      totalMinutes += minutes;
      totalCents += cents;
      const o = openBy.get(m.id);
      staff.push({
        id: m.id, name: m.name, role: m.role, active: m.active,
        hourlyRate: m.hourlyRate === null ? null : Number(m.hourlyRate),
        openShift: o ? { id: o.id, clockIn: o.clockIn.toISOString() } : null,
        minutes, amount: cents / 100, missingRate, shifts: rows,
      });
    }
    return { weekStart, weekEnd, staff, totals: { minutes: totalMinutes, amount: totalCents / 100 } };
  },

  /** CSV de la semana: una fila por turno, más el total por persona. */
  async weekCsv(restaurantId: number, anyDay?: DayKey): Promise<{ csv: string; weekStart: DayKey }> {
    const w = await staffShiftsService.week(restaurantId, anyDay);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const hours = (min: number) => (min / 60).toFixed(2).replace('.', ',');
    const money = (n: number) => n.toFixed(2).replace('.', ',');
    const lines = [['Empleado', 'Dia', 'Entrada', 'Salida', 'Horas', 'Valor hora', 'Monto', 'Nota'].join(';')];
    for (const m of w.staff) {
      for (const s of m.shifts) {
        lines.push([
          m.name, s.day, formatLocalDateTime(new Date(s.clockIn)).slice(11, 16),
          s.clockOut ? formatLocalDateTime(new Date(s.clockOut)).slice(11, 16) : 'sin salida',
          hours(s.minutes), s.hourlyRate === null ? '' : money(s.hourlyRate), money(s.amount), s.note ?? '',
        ].map(esc).join(';'));
      }
      if (m.shifts.length) lines.push([m.name, 'TOTAL SEMANA', '', '', hours(m.minutes), '', money(m.amount), ''].map(esc).join(';'));
    }
    lines.push(['TOTAL', '', '', '', hours(w.totals.minutes), '', money(w.totals.amount), ''].map(esc).join(';'));
    return { csv: '﻿' + lines.join('\r\n'), weekStart: w.weekStart };
  },
};
