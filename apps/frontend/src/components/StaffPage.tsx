// ──────────────────────────────────────────────
// StaffPage.tsx — Gestión de personal con consulta ARCA
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, Search, Mail, Phone,
  ToggleLeft, ToggleRight, UserPlus, ExternalLink, RefreshCw,
  ShieldCheck, ShieldX, HelpCircle, AlertTriangle,
} from 'lucide-react';
import { useStaff } from '../hooks/useStaff';
import { staffApi, type StaffMember, type StaffRole, type ArcaPadronData, ApiError } from '../lib/api';
import {
  STAFF_ROLE_LABEL, STAFF_ROLE_OPTIONS, STAFF_ROLE_STYLE, initials,
} from '../lib/admin-helpers';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

// ── Helpers ARCA ──
function formatCuit(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  return raw;
}

function extractMonotributoCategory(arca: ArcaPadronData): string | null {
  for (const cat of arca.categorias) {
    const desc = cat.descripcionCategoria.toUpperCase();
    if (desc.includes('MONOTRIBUTO') || desc.includes('MONO')) {
      // Intenta extraer la categoría (A, B, C...)
      const match = desc.match(/CATEGORIA\s+([A-Z])/);
      return match ? `Categoría ${match[1]}` : cat.descripcionCategoria;
    }
  }
  return null;
}

function isMonotributista(arca: ArcaPadronData): boolean {
  // idImpuesto 20 = MONOTRIBUTO en AFIP
  return arca.impuestos.some(i => i.idImpuesto === 20 || i.descripcionImpuesto.toUpperCase().includes('MONOTRIBUTO'));
}

// ──────────────────────────────────────────────
// Widget de consulta ARCA
// ──────────────────────────────────────────────
function ArcaWidget({ member }: { member: StaffMember }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ArcaPadronData | null>(null);
  const [open, setOpen] = useState(false);

  async function consultar(force = false) {
    setLoading(true);
    try {
      if (force) await staffApi.invalidateArcaCache(member.id);
      const { arca } = await staffApi.queryArca(member.id);
      setData(arca);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al consultar ARCA');
    } finally {
      setLoading(false);
    }
  }

  const isActive  = data?.estadoClave === 'ACTIVO';
  const isError   = data?.estadoClave === 'ERROR_CONSULTA' || data?.estadoClave === 'NO_ENCONTRADO';
  const hasData   = !!data && !isError;
  const monocat   = data ? extractMonotributoCategory(data) : null;
  const isMono    = data ? isMonotributista(data) : false;

  const cuitUrl = `https://auth.afip.gob.ar/contribuyente_/login.xhtml`;

  if (!member.cuit) {
    return (
      <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Sin CUIT
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => consultar()}
        disabled={loading}
        title={`Consultar estado ARCA — CUIT: ${formatCuit(member.cuit!)}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
          hasData && isActive
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15'
            : hasData && !isActive
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/15'
              : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
        )}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : hasData && isActive ? (
          <ShieldCheck className="h-3 w-3" />
        ) : hasData && !isActive ? (
          <ShieldX className="h-3 w-3" />
        ) : (
          <HelpCircle className="h-3 w-3" />
        )}
        {hasData ? (isActive ? 'ARCA: Activo' : 'ARCA: Inactivo') : 'Ver ARCA'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isActive
                ? <ShieldCheck className="h-5 w-5 text-emerald-400" />
                : <ShieldX className="h-5 w-5 text-rose-400" />
              }
              Estado ARCA — {member.name}
            </DialogTitle>
            <DialogDescription>
              CUIT: <span className="font-mono font-medium text-foreground">{formatCuit(member.cuit!)}</span>
            </DialogDescription>
          </DialogHeader>

          {data && (
            <div className="space-y-4">
              {/* Estado general */}
              <div className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3',
                isActive
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : isError
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-rose-500/30 bg-rose-500/5'
              )}>
                {isActive
                  ? <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-400" />
                  : isError
                    ? <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
                    : <ShieldX className="h-6 w-6 shrink-0 text-rose-400" />
                }
                <div>
                  <p className={cn('font-semibold', isActive ? 'text-emerald-400' : isError ? 'text-amber-400' : 'text-rose-400')}>
                    {data.estadoClave.replace(/_/g, ' ')}
                  </p>
                  {data.nombre && (
                    <p className="text-sm text-foreground">{data.nombre}</p>
                  )}
                  {data.error && (
                    <p className="text-xs text-muted-foreground">{data.error}</p>
                  )}
                </div>
              </div>

              {/* Info fiscal */}
              {!isError && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border bg-background/50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Condición</p>
                    <p className="mt-1 text-sm font-medium">
                      {isMono ? 'Monotributista' : data.impuestos.length > 0 ? 'Responsable Inscripto' : 'Sin impuestos'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-background/50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Categoría</p>
                    <p className="mt-1 text-sm font-medium">
                      {monocat ?? (isMono ? 'Monotributo' : '—')}
                    </p>
                  </div>
                </div>
              )}

              {/* Impuestos registrados */}
              {!isError && data.impuestos.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Impuestos registrados</p>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {data.impuestos.map((imp) => (
                      <div key={imp.idImpuesto} className="flex items-center gap-2 rounded-lg bg-secondary/30 px-3 py-1.5 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {imp.descripcionImpuesto}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Aviso sobre deuda */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/80">
                <p className="font-medium text-amber-300">Información de deuda o cuotas impagas</p>
                <p className="mt-1">
                  Esta consulta muestra el estado de inscripción en el padrón público de ARCA.
                  Para ver deuda, cuotas y obligaciones, el empleado debe ingresar con su propia
                  clave fiscal en el portal de ARCA.
                </p>
              </div>

              {/* Timestamp y acciones */}
              <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Consultado: {new Date(data.fetchedAt).toLocaleString('es-AR')}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => consultar(true)} disabled={loading}>
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Actualizar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.open(cuitUrl, '_blank')}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Portal ARCA
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────────────────────────
// Formulario (estado + handlers)
// ──────────────────────────────────────────────
interface FormState {
  name: string;
  email: string;
  role: StaffRole;
  phone: string;
  cuit: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '', email: '', role: 'WAITER', phone: '', cuit: '', active: true,
};

export function StaffPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { members, loading } = useStaff();
  const [filter, setFilter] = useState<StaffRole | 'ALL' | 'INACTIVE'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return members.filter(m => {
      if (filter === 'INACTIVE') { if (m.active) return false; }
      else if (filter !== 'ALL') { if (m.role !== filter || !m.active) return false; }
      else { if (!m.active) return false; }
      if (s && !m.name.toLowerCase().includes(s) && !m.email.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [members, filter, search]);

  const activeCount   = members.filter(m => m.active).length;
  const inactiveCount = members.length - activeCount;

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Solo los administradores pueden gestionar el personal.</p>
      </div>
    );
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(member: StaffMember) {
    setForm({
      name:   member.name,
      email:  member.email,
      role:   member.role,
      phone:  member.phone ?? '',
      cuit:   member.cuit ? formatCuit(member.cuit) : '',
      active: member.active,
    });
    setEditing(member);
    setCreating(false);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nombre y email son obligatorios');
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        name:   form.name.trim(),
        email:  form.email.trim(),
        role:   form.role,
        phone:  form.phone.trim() || null,
        cuit:   form.cuit.trim() || null,
        active: form.active,
      };
      if (editing) {
        await staffApi.update(editing.id, data);
        toast.success(`"${data.name}" actualizado`);
      } else {
        await staffApi.create(data);
        toast.success(`"${data.name}" agregado al equipo`);
      }
      closeForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(member: StaffMember) {
    if (!window.confirm(`¿Eliminar a "${member.name}" del registro?`)) return;
    try {
      await staffApi.remove(member.id);
      toast.success(`"${member.name}" eliminado`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleToggle(member: StaffMember) {
    try {
      await staffApi.toggleActive(member.id);
      toast.success(`"${member.name}" ${member.active ? 'dado de baja' : 'reactivado'}`);
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
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Personal</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} {activeCount === 1 ? 'activo' : 'activos'}
            {inactiveCount > 0 && ` · ${inactiveCount} inactivos`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <UserPlus className="h-4 w-4" />
          Nuevo miembro
        </Button>
      </div>

      {/* Búsqueda + filtros */}
      <div className="mb-6 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, email o CUIT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="Activos" count={activeCount} />
          {STAFF_ROLE_OPTIONS.map(r => {
            const count = members.filter(m => m.role === r.value && m.active).length;
            return (
              <FilterChip key={r.value} active={filter === r.value} onClick={() => setFilter(r.value)} label={r.label} count={count} />
            );
          })}
          {inactiveCount > 0 && (
            <FilterChip active={filter === 'INACTIVE'} onClick={() => setFilter('INACTIVE')} label="Inactivos" count={inactiveCount} muted />
          )}
        </div>
      </div>

      {/* Grid de miembros */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {search ? 'No hay resultados para esa búsqueda' : 'No hay miembros en este filtro'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(m => {
            const roleStyle = STAFF_ROLE_STYLE[m.role];
            return (
              <div
                key={m.id}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border border-border bg-card p-4',
                  !m.active && 'opacity-60'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold',
                    roleStyle.border, roleStyle.bg, roleStyle.text
                  )}>
                    {initials(m.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{m.name}</p>
                      {!m.active && (
                        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-400">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        roleStyle.text, roleStyle.bg
                      )}>
                        {STAFF_ROLE_LABEL[m.role]}
                      </span>
                      <ArcaWidget member={m} />
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3 w-3 shrink-0" /> {m.email}
                  </p>
                  {m.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 shrink-0" /> {m.phone}
                    </p>
                  )}
                  {m.cuit && (
                    <p className="flex items-center gap-1.5 font-mono">
                      <span className="text-[10px] uppercase tracking-wider not-italic font-sans">CUIT</span>
                      {formatCuit(m.cuit)}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1 border-t border-border pt-3">
                  <Button variant="ghost" size="icon" onClick={() => handleToggle(m)} title={m.active ? 'Dar de baja' : 'Reactivar'}>
                    {m.active
                      ? <ToggleRight className="h-5 w-5 text-emerald-400" />
                      : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                    }
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)} title="Editar">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(m)} title="Eliminar" className="text-rose-400 hover:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear / editar */}
      <Dialog open={creating || editing !== null} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar miembro' : 'Nuevo miembro del equipo'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre completo *</Label>
              <Input id="name" value={form.name} autoFocus
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting} placeholder="María Rodríguez"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                disabled={submitting} placeholder="maria@resto.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="role">Rol *</Label>
                <Select id="role" value={form.role} disabled={submitting}
                  onChange={(e) => setForm(f => ({ ...f, role: e.target.value as StaffRole }))}
                >
                  {STAFF_ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" type="tel" value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  disabled={submitting} placeholder="+54 11 5555-0101"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT</Label>
              <Input id="cuit" type="text" inputMode="numeric" value={form.cuit}
                onChange={(e) => setForm(f => ({ ...f, cuit: e.target.value }))}
                disabled={submitting} placeholder="20-12345678-9"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Formato: 20-12345678-9. Con o sin guiones. Prefijos válidos: 20, 23, 24, 27, 30, 33, 34.
                Necesario para consultar el estado en ARCA.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Estado activo</p>
                <p className="text-xs text-muted-foreground">Los inactivos no aparecen por defecto</p>
              </div>
              <button type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))} disabled={submitting}>
                {form.active
                  ? <ToggleRight className="h-6 w-6 text-emerald-400" />
                  : <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                }
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Guardar' : <><Plus className="h-4 w-4" /> Crear</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, muted }: {
  active: boolean; onClick: () => void; label: string; count: number; muted?: boolean;
}) {
  return (
    <button onClick={onClick} className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      active
        ? muted ? 'border-muted-foreground/40 bg-secondary text-foreground' : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
        : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
    )}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active && !muted ? 'bg-emerald-500/20' : 'bg-background/50')}>
        {count}
      </span>
    </button>
  );
}
