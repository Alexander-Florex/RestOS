// ──────────────────────────────────────────────
// UsersPage.tsx — Gestión de cuentas de login y su rol
// Requiere el permiso users.manage.
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, Search, Mail, UserCog,
  ToggleLeft, ToggleRight, KeyRound, ShieldAlert,
} from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../hooks/useRoles';
import { usersApi, type AppUser, ApiError } from '../lib/api';
import { roleStyle, initials } from '../lib/admin-helpers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { useConfirm } from './ui/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

interface FormState {
  username: string;
  email: string;
  name: string;
  roleId: number | null;
  password: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  username: '', email: '', name: '', roleId: null, password: '', active: true,
};

export function UsersPage() {
  const { user: me, can } = useAuth();
  const isAdmin = can('users.manage');
  const { roles } = useRoles();
  const confirm = useConfirm();

  const { users, loading } = useUsers();
  const [filter, setFilter] = useState<number | 'ALL' | 'INACTIVE'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter(u => {
      if (filter === 'INACTIVE') { if (u.active) return false; }
      else if (filter !== 'ALL') { if (u.roleId !== filter || !u.active) return false; }
      else { if (!u.active) return false; }
      if (s && !u.name.toLowerCase().includes(s) && !u.username.toLowerCase().includes(s) && !u.email.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [users, filter, search]);

  const activeCount   = users.filter(u => u.active).length;
  const inactiveCount = users.length - activeCount;

  if (!isAdmin) {
    return (
      <div className="glass rounded-3xl p-12 text-center">
        <p className="text-sm text-muted-foreground">Tu rol no tiene permiso para gestionar usuarios.</p>
      </div>
    );
  }

  function openCreate() {
    // Por defecto, el rol Mesero (o el primero disponible)
    const defaultRole = roles.find(r => r.key === 'WAITER') ?? roles[0];
    setForm({ ...EMPTY_FORM, roleId: defaultRole?.id ?? null });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(u: AppUser) {
    setForm({
      username: u.username,
      email: u.email,
      name: u.name,
      roleId: u.roleId,
      password: '',
      active: u.active,
    });
    setEditing(u);
    setCreating(false);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit() {
    if (!form.username.trim() || !form.email.trim() || !form.name.trim()) {
      toast.error('Usuario, email y nombre son obligatorios');
      return;
    }
    if (form.roleId === null) {
      toast.error('Elegí un rol');
      return;
    }
    if (creating && form.password.length < 4) {
      toast.error('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    if (!creating && form.password && form.password.length < 4) {
      toast.error('La nueva contraseña debe tener al menos 4 caracteres');
      return;
    }

    setSubmitting(true);
    try {
      if (editing) {
        await usersApi.update(editing.id, {
          username: form.username.trim(),
          email: form.email.trim(),
          name: form.name.trim(),
          roleId: form.roleId,
          active: form.active,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success(`"${form.name}" actualizado`);
      } else {
        await usersApi.create({
          username: form.username.trim(),
          email: form.email.trim(),
          name: form.name.trim(),
          roleId: form.roleId,
          password: form.password,
          active: form.active,
        });
        toast.success(`Usuario "${form.username}" creado`);
      }
      closeForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(u: AppUser) {
    if (!await confirm({ title: `¿Eliminar la cuenta "${u.username}"?`, description: 'Esta acción no se puede deshacer.', variant: 'destructive', confirmLabel: 'Eliminar' })) return;
    try {
      await usersApi.remove(u.id);
      toast.success(`Cuenta "${u.username}" eliminada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleToggle(u: AppUser) {
    try {
      await usersApi.toggleActive(u.id);
      toast.success(`"${u.name}" ${u.active ? 'desactivado' : 'reactivado'}`);
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Accesos</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Usuarios</h2>
          <p className="text-sm text-muted-foreground">
            Cuentas para iniciar sesión en el sistema — {activeCount} {activeCount === 1 ? 'activa' : 'activas'}
            {inactiveCount > 0 && ` · ${inactiveCount} inactivas`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      {/* Aviso */}
      <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/80">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Estas son las credenciales con las que cada persona inicia sesión (usuario + contraseña + ID de restaurante).
          No confundir con "Personal", que son fichas informativas del equipo.
        </p>
      </div>

      {/* Búsqueda + filtros */}
      <div className="mb-6 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, usuario o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="Activos" count={activeCount} />
          {roles.map(r => {
            const count = users.filter(u => u.roleId === r.id && u.active).length;
            return (
              <FilterChip key={r.id} active={filter === r.id} onClick={() => setFilter(r.id)} label={r.name} count={count} />
            );
          })}
          {inactiveCount > 0 && (
            <FilterChip active={filter === 'INACTIVE'} onClick={() => setFilter('INACTIVE')} label="Inactivos" count={inactiveCount} muted />
          )}
        </div>
      </div>

      {/* Grid de usuarios */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
          {search ? 'No hay resultados para esa búsqueda' : 'No hay usuarios en este filtro'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(u => {
            const style = roleStyle(roles.find(r => r.id === u.roleId));
            const isMe = u.id === me?.id;
            return (
              <div
                key={u.id}
                className={cn(
                  'flex flex-col gap-3 glass rounded-3xl p-4',
                  !u.active && 'opacity-60'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold',
                    style.border, style.bg, style.text
                  )}>
                    {initials(u.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{u.name}</p>
                      {isMe && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Tú
                        </span>
                      )}
                      {!u.active && (
                        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-400">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        style.text, style.bg
                      )}>
                        {u.roleName ?? 'Sin rol'}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        <UserCog className="h-3 w-3" /> @{u.username}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3 w-3 shrink-0" /> {u.email}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-1 border-t border-border pt-3">
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => handleToggle(u)}
                    disabled={isMe}
                    title={isMe ? 'No podés desactivar tu propia cuenta' : (u.active ? 'Desactivar' : 'Reactivar')}
                  >
                    {u.active
                      ? <ToggleRight className="h-5 w-5 text-brand-400" />
                      : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                    }
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Editar">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => handleDelete(u)}
                    disabled={isMe}
                    title={isMe ? 'No podés eliminar tu propia cuenta' : 'Eliminar'}
                    className="text-rose-400 hover:text-rose-300 disabled:text-muted-foreground"
                  >
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
            <DialogTitle>{editing ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre completo *</Label>
              <Input id="name" value={form.name} autoFocus
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting} placeholder="María Rodríguez"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario *</Label>
                <Input id="username" value={form.username} autoComplete="off"
                  onChange={(e) => setForm(f => ({ ...f, username: e.target.value.trim() }))}
                  disabled={submitting} placeholder="maria"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Rol *</Label>
                <Select id="role" value={form.roleId ?? ''} disabled={submitting || (editing?.id === me?.id)}
                  onChange={(e) => setForm(f => ({ ...f, roleId: e.target.value ? Number(e.target.value) : null }))}
                >
                  {form.roleId === null && <option value="">Elegí un rol</option>}
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                disabled={submitting} placeholder="maria@resto.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                {editing ? 'Nueva contraseña' : 'Contraseña *'}
              </Label>
              <Input id="password" type="password" value={form.password} autoComplete="new-password"
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                disabled={submitting} placeholder={editing ? 'Dejar vacío para no cambiarla' : 'Mínimo 4 caracteres'}
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Cuenta activa</p>
                <p className="text-xs text-muted-foreground">Las cuentas inactivas no pueden iniciar sesión</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                disabled={submitting || editing?.id === me?.id}
                title={editing?.id === me?.id ? 'No podés desactivar tu propia cuenta' : undefined}
              >
                {form.active
                  ? <ToggleRight className="h-6 w-6 text-brand-400" />
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
        ? muted ? 'border-muted-foreground/40 bg-secondary text-foreground' : 'border-brand-500/50 bg-brand-500/10 text-brand-400'
        : 'border-border bg-white/[0.06] text-muted-foreground hover:text-foreground'
    )}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active && !muted ? 'bg-brand-500/20' : 'bg-white/[0.03]')}>
        {count}
      </span>
    </button>
  );
}
