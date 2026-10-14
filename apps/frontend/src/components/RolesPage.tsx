// ──────────────────────────────────────────────
// RolesPage.tsx — Roles y permisos del restaurante
// Administrador (fijo, todos los permisos), Mesero y Cajero vienen de base;
// el administrador puede crear roles nuevos y elegir qué puede hacer cada uno.
// Requiere el permiso users.manage.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Plus, Loader2, Lock, ShieldCheck, Trash2, Users, Save, Copy, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRoles } from '../hooks/useRoles';
import { rolesApi, type AppRole, ApiError } from '../lib/api';
import type { Permission } from '../lib/permissions';
import { roleStyle } from '../lib/admin-helpers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useConfirm } from './ui/confirm-dialog';
import { EASE_OUT, PageHeader } from './ui/motion';
import { cn } from '../lib/utils';

/** Rol en edición. id null = rol nuevo todavía sin guardar. */
interface Draft {
  id: number | null;
  name: string;
  permissions: Permission[];
}

export function RolesPage() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { roles, catalog, loading, refresh } = useRoles();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = typeof selectedId === 'number' ? roles.find(r => r.id === selectedId) ?? null : null;

  // Al cargar, seleccionar el primer rol
  useEffect(() => {
    if (selectedId === null && roles.length > 0) select(roles[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof catalog>();
    for (const p of catalog) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return [...map.entries()];
  }, [catalog]);

  if (!can('users.manage')) {
    return (
      <div className="glass rounded-3xl p-12 text-center">
        <p className="text-sm text-muted-foreground">Tu rol no tiene permiso para gestionar roles.</p>
      </div>
    );
  }

  function select(role: AppRole) {
    setSelectedId(role.id);
    setDraft({ id: role.id, name: role.name, permissions: [...role.permissions] });
  }

  function startNew(base?: AppRole) {
    setSelectedId('new');
    setDraft({
      id: null,
      name: base ? `${base.name} (copia)` : '',
      permissions: base ? base.permissions.filter(p => p !== 'users.manage') : ['orders.create'],
    });
  }

  function toggle(p: Permission) {
    setDraft(d => d && ({
      ...d,
      permissions: d.permissions.includes(p) ? d.permissions.filter(x => x !== p) : [...d.permissions, p],
    }));
  }

  const locked = selected?.locked ?? false;
  const dirty = !!draft && (
    draft.id === null ||
    (selected !== null && (draft.name !== selected.name || [...draft.permissions].sort().join() !== [...selected.permissions].sort().join()))
  );

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 2) { toast.error('Poné un nombre de al menos 2 letras'); return; }
    setSaving(true);
    try {
      if (draft.id === null) {
        const { role } = await rolesApi.create({ name: draft.name.trim(), permissions: draft.permissions });
        toast.success(`Rol "${role.name}" creado`);
        await refresh();
        select(role);
      } else {
        const { role } = await rolesApi.update(draft.id, { name: draft.name.trim(), permissions: draft.permissions });
        toast.success(`Rol "${role.name}" actualizado`);
        await refresh();
        select(role);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar el rol');
    } finally {
      setSaving(false);
    }
  }

  async function remove(role: AppRole) {
    const ok = await confirm({
      title: `¿Eliminar el rol "${role.name}"?`,
      description: 'Los usuarios tienen que tener otro rol asignado antes de poder eliminarlo.',
      variant: 'destructive',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await rolesApi.remove(role.id);
      toast.success(`Rol "${role.name}" eliminado`);
      setSelectedId(null);
      setDraft(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el rol');
    }
  }

  if (loading) {
    return (
      <div>
        <div className="skeleton mb-10 h-12 w-56" />
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="skeleton h-80 rounded-3xl" />
          <div className="skeleton h-[520px] rounded-3xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Accesos"
        title="Roles"
        description="Definí qué puede hacer cada persona. Los cambios se aplican en segundos, sin volver a iniciar sesión."
        actions={
          <Button onClick={() => startNew()}>
            <Plus className="h-4 w-4" />
            Nuevo rol
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Lista de roles ── */}
        <div className="space-y-2">
          {roles.map((r, i) => {
            const st = roleStyle(r);
            const active = selectedId === r.id;
            return (
              <motion.button
                key={r.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.4, ease: EASE_OUT }}
                onClick={() => select(r)}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors',
                  active ? 'border-brand-400/40 bg-brand-500/10' : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05]'
                )}
              >
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', st.border, st.bg, st.text)}>
                  {r.locked ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    {r.system && (
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Base
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{r.userCount}</span>
                    <span>{r.locked ? 'Todos los permisos' : `${r.permissions.length} ${r.permissions.length === 1 ? 'permiso' : 'permisos'}`}</span>
                  </span>
                </span>
              </motion.button>
            );
          })}
          <AnimatePresence>
            {selectedId === 'new' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-brand-400/40 bg-brand-500/[0.06] p-3.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-brand-200">{draft?.name.trim() || 'Rol nuevo'}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Editor ── */}
        <AnimatePresence mode="wait">
          {draft && (
            <motion.div
              key={draft.id ?? 'new'}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className="glass rounded-3xl p-5 sm:p-6"
            >
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="role-name">Nombre del rol</Label>
                  <Input
                    id="role-name" value={draft.name} disabled={locked || saving} placeholder="Ej: Encargado, Cocina, Bachero"
                    onChange={(e) => setDraft(d => d && ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  {selected && !locked && (
                    <Button variant="outline" size="sm" className="h-11" onClick={() => startNew(selected)} title="Crear un rol nuevo a partir de este">
                      <Copy className="h-4 w-4" />
                      Duplicar
                    </Button>
                  )}
                  {selected && !selected.system && (
                    <Button variant="outline" size="sm" className="h-11 text-rose-300 hover:border-rose-400/30 hover:bg-rose-500/10" onClick={() => remove(selected)}>
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </Button>
                  )}
                </div>
              </div>

              {locked && (
                <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-brand-400/20 bg-brand-500/[0.07] p-3.5 text-xs text-brand-100/80">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                  El rol Administrador tiene siempre todos los permisos y no se puede modificar, para que nunca quede el sistema sin alguien que lo gestione.
                </div>
              )}

              <div className="space-y-6">
                {groups.map(([group, perms]) => (
                  <div key={group}>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {perms.map(p => {
                        const on = locked || draft.permissions.includes(p.key);
                        return (
                          <button
                            key={p.key}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            disabled={locked || saving}
                            onClick={() => toggle(p.key)}
                            className={cn(
                              'flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors disabled:cursor-default',
                              on ? 'border-brand-400/30 bg-brand-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.045]'
                            )}
                          >
                            <span className={cn(
                              'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
                              on ? 'bg-gradient-to-r from-brand-400 to-brand-600' : 'bg-white/15'
                            )}>
                              <motion.span
                                layout
                                transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                                className={cn('flex h-4 w-4 items-center justify-center rounded-full bg-white shadow', on ? 'ml-auto' : 'ml-0')}
                              >
                                {on && <Check className="h-2.5 w-2.5 text-brand-600" strokeWidth={3} />}
                              </motion.span>
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{p.label}</span>
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{p.description}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {!locked && (
                <div className="sticky bottom-24 mt-6 flex items-center justify-end gap-2 md:bottom-4">
                  {draft.id !== null && dirty && (
                    <Button variant="ghost" onClick={() => selected && select(selected)} disabled={saving}>Descartar</Button>
                  )}
                  <Button onClick={save} disabled={saving || !dirty}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {draft.id === null ? 'Crear rol' : 'Guardar cambios'}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
