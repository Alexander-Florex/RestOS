// ──────────────────────────────────────────────
// staff.service.ts — Lógica del personal + consulta ARCA
// ──────────────────────────────────────────────
import { StaffRole, type StaffMember } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emitChanged(member: StaffMember) { getIO().emit(SocketEvents.STAFF_CHANGED, member); }
function emitCreated(member: StaffMember) { getIO().emit(SocketEvents.STAFF_CREATED, member); }
function emitDeleted(id: number)          { getIO().emit(SocketEvents.STAFF_DELETED, { id }); }

// ── ARCA / AFIP — consulta pública del padrón ──
// Caché en memoria con TTL de 4 horas para no saturar el endpoint de AFIP
const ARCA_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
interface ArcaCacheEntry { data: ArcaPadronData; fetchedAt: number }
const arcaCache = new Map<string, ArcaCacheEntry>();

export interface ArcaPadronData {
  cuit: string;
  nombre: string;
  tipoPersona: string;     // 'FISICA' | 'JURIDICA'
  estadoClave: string;     // 'ACTIVO' | 'INACTIVO' | ...
  impuestos: Array<{ idImpuesto: number; descripcionImpuesto: string; periodoDesde?: string }>;
  categorias: Array<{ idCategoria: number; descripcionCategoria: string; periodo?: string }>;
  actividades: Array<{ idActividad: number; descripcionActividad: string }>;
  fetchedAt: string;       // ISO — cuándo se consultó
  error?: string;          // si la consulta falló
}

/** Normaliza CUIT: quita guiones y espacios, devuelve solo los 11 dígitos */
function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}

/** Valida formato CUIT argentino (11 dígitos, prefijo válido) */
function validateCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const valid = ['20','23','24','27','30','33','34'];
  return valid.includes(cuit.slice(0, 2));
}

/**
 * Consulta el padrón público de ARCA/AFIP.
 * Usa caché con TTL de 4 horas para no saturar el servicio.
 * NOTA: Solo devuelve datos de inscripción y categoría de monotributo.
 * La deuda requiere autenticación con clave fiscal propia del contribuyente.
 */
async function fetchArcaPadron(cuit: string): Promise<ArcaPadronData> {
  const cached = arcaCache.get(cuit);
  if (cached && Date.now() - cached.fetchedAt < ARCA_CACHE_TTL_MS) {
    return cached.data;
  }

  // La API pública de AFIP/ARCA para consultar el padrón
  const url = `https://sumi.afip.gob.ar/padron/api/personas/${cuit}`;
  let data: ArcaPadronData;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'RestOS/1.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      data = {
        cuit,
        nombre: '',
        tipoPersona: '',
        estadoClave: 'NO_ENCONTRADO',
        impuestos: [],
        categorias: [],
        actividades: [],
        fetchedAt: new Date().toISOString(),
        error: 'CUIT no encontrado en el padrón de ARCA',
      };
    } else if (!res.ok) {
      throw new Error(`ARCA respondió con HTTP ${res.status}`);
    } else {
      const json = await res.json() as { data?: {
        idPersona?: number;
        nombre?: string;
        tipoPersona?: string;
        estadoClave?: string;
        impuestos?: Array<{ idImpuesto: number; descripcionImpuesto: string; periodoDesde?: string }>;
        categorias?: Array<{ idCategoria: number; descripcionCategoria: string; periodo?: string }>;
        actividades?: Array<{ idActividad: number; descripcionActividad: string }>;
      }};
      const d = json.data ?? {};
      data = {
        cuit,
        nombre: d.nombre ?? '',
        tipoPersona: d.tipoPersona ?? '',
        estadoClave: d.estadoClave ?? 'DESCONOCIDO',
        impuestos: d.impuestos ?? [],
        categorias: d.categorias ?? [],
        actividades: d.actividades ?? [],
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    data = {
      cuit,
      nombre: '',
      tipoPersona: '',
      estadoClave: 'ERROR_CONSULTA',
      impuestos: [],
      categorias: [],
      actividades: [],
      fetchedAt: new Date().toISOString(),
      error: `No se pudo consultar ARCA: ${msg}`,
    };
  }

  arcaCache.set(cuit, { data, fetchedAt: Date.now() });
  return data;
}

export interface CreateStaffData {
  name: string;
  email: string;
  role: StaffRole;
  phone?: string;
  active?: boolean;
  cuit?: string | null;
}

export interface UpdateStaffData extends Partial<CreateStaffData> {}

export const staffService = {
  async list(opts?: { role?: StaffRole; activeOnly?: boolean }): Promise<StaffMember[]> {
    return prisma.staffMember.findMany({
      where: {
        ...(opts?.role ? { role: opts.role } : {}),
        ...(opts?.activeOnly ? { active: true } : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  },

  async getById(id: number): Promise<StaffMember> {
    const member = await prisma.staffMember.findUnique({ where: { id } });
    if (!member) throw HttpError.notFound('Miembro de personal no encontrado');
    return member;
  },

  async create(data: CreateStaffData): Promise<StaffMember> {
    const existing = await prisma.staffMember.findUnique({ where: { email: data.email } });
    if (existing) throw HttpError.conflict('Ya existe un miembro con ese email');

    // Normalizar CUIT si viene
    const cuitNorm = data.cuit ? normalizeCuit(data.cuit) : null;
    if (cuitNorm && !validateCuit(cuitNorm)) {
      throw HttpError.badRequest('CUIT inválido (debe tener 11 dígitos con prefijo válido: 20, 23, 24, 27, 30, 33 o 34)');
    }

    const member = await prisma.staffMember.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        phone: data.phone ?? null,
        active: data.active ?? true,
        cuit: cuitNorm,
      },
    });
    emitCreated(member);
    return member;
  },

  async update(id: number, data: UpdateStaffData): Promise<StaffMember> {
    const current = await staffService.getById(id);

    if (data.email !== undefined && data.email !== current.email) {
      const dup = await prisma.staffMember.findUnique({ where: { email: data.email } });
      if (dup) throw HttpError.conflict('Ya existe un miembro con ese email');
    }

    let cuitNorm: string | null | undefined = undefined;
    if (data.cuit !== undefined) {
      if (data.cuit === null || data.cuit === '') {
        cuitNorm = null;
      } else {
        cuitNorm = normalizeCuit(data.cuit);
        if (!validateCuit(cuitNorm)) {
          throw HttpError.badRequest('CUIT inválido (debe tener 11 dígitos con prefijo válido)');
        }
      }
      // Limpiar caché si cambió el CUIT
      if (current.cuit && cuitNorm !== current.cuit) arcaCache.delete(current.cuit);
    }

    const member = await prisma.staffMember.update({
      where: { id },
      data: {
        ...(data.name !== undefined   ? { name: data.name }     : {}),
        ...(data.email !== undefined  ? { email: data.email }   : {}),
        ...(data.role !== undefined   ? { role: data.role }     : {}),
        ...(data.phone !== undefined  ? { phone: data.phone }   : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(cuitNorm !== undefined    ? { cuit: cuitNorm }      : {}),
      },
    });
    emitChanged(member);
    return member;
  },

  /** Consulta el padrón público de ARCA para el miembro indicado. */
  async queryArca(id: number): Promise<ArcaPadronData> {
    const member = await staffService.getById(id);
    if (!member.cuit) {
      throw HttpError.badRequest('Este miembro no tiene CUIT registrado. Agregalo primero desde la edición.');
    }
    const cuit = normalizeCuit(member.cuit);
    if (!validateCuit(cuit)) {
      throw HttpError.badRequest('El CUIT registrado tiene un formato inválido. Editalo para corregirlo.');
    }
    return fetchArcaPadron(cuit);
  },

  /** Invalida el caché de ARCA para un miembro específico (fuerza re-consulta). */
  async invalidateArcaCache(id: number): Promise<void> {
    const member = await staffService.getById(id);
    if (member.cuit) arcaCache.delete(normalizeCuit(member.cuit));
  },

  /** Información de cuándo se hizo la última consulta (null si no hay caché). */
  arcaCacheAge(cuit: string): number | null {
    const entry = arcaCache.get(normalizeCuit(cuit));
    return entry ? Date.now() - entry.fetchedAt : null;
  },

  async remove(id: number): Promise<void> {
    await staffService.getById(id);
    await prisma.staffMember.delete({ where: { id } });
    emitDeleted(id);
  },

  async toggleActive(id: number): Promise<StaffMember> {
    const current = await staffService.getById(id);
    const member = await prisma.staffMember.update({
      where: { id },
      data: { active: !current.active },
    });
    emitChanged(member);
    return member;
  },
};
