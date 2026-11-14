// ──────────────────────────────────────────────
// Reservas (tarea 5.5): una mesa no puede tener dos reservas activas que se pisen.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { reservationsService } from '../src/modules/reservations/reservations.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => { await prisma.restaurant.deleteMany(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
const at = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 10, h + 3, m)); // hora de Buenos Aires

test('no deja reservar la misma mesa en horarios que se pisan; sí pegadas o en otra mesa', async () => {
  const r = (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
  const t1 = await prisma.table.create({ data: { restaurantId: r, number: 1, capacity: 6 } });
  const t2 = await prisma.table.create({ data: { restaurantId: r, number: 2, capacity: 6 } });
  const base = { customerName: 'Ana', partySize: 4, tableId: t1.id };
  const first = await reservationsService.create(r, { ...base, reservedAt: at(21), duration: 90 }); // 21:00 a 22:30
  await assert.rejects(reservationsService.create(r, { ...base, customerName: 'Beto', reservedAt: at(22), duration: 90 }), (e: unknown) => {
    assert.ok(isHttp(409)(e));
    assert.match((e as Error).message, /Ana de 21:00 a 22:30/);
    return true;
  });
  await assert.rejects(reservationsService.create(r, { ...base, reservedAt: at(20), duration: 90 }), isHttp(409)); // 20:00 a 21:30
  await reservationsService.create(r, { ...base, reservedAt: at(22, 30), duration: 60 });  // justo después
  await reservationsService.create(r, { ...base, reservedAt: at(19), duration: 120 });     // termina 21:00
  await reservationsService.create(r, { ...base, tableId: t2.id, reservedAt: at(21), duration: 90 }); // otra mesa
  // Una cancelada libera el horario
  await reservationsService.update(r, first.id, { status: 'CANCELLED' });
  await reservationsService.create(r, { ...base, customerName: 'Carla', reservedAt: at(21, 15), duration: 60 });
  // Mover una existente a un horario ocupado también se rechaza
  const other = await reservationsService.create(r, { ...base, tableId: t2.id, reservedAt: at(13), duration: 60 });
  await assert.rejects(reservationsService.update(r, other.id, { tableId: t1.id, reservedAt: at(21, 30) }), isHttp(409));
});
