// ──────────────────────────────────────────────
// MenuPage.tsx — Gestión del catálogo de menú (admin)
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, Check, X, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useMenu } from '../hooks/useMenu';
import { menuApi, type MenuItem, type StockStatus, ApiError } from '../lib/api';
import {
  categoryLabel, CATEGORY_OPTIONS, STOCK_LABEL, STOCK_STYLE,
} from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

interface FormState {
  name: string;
  category: string;
  price: string;
  description: string;
  stock: StockStatus;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'main-dishes',
  price: '',
  description: '',
  stock: 'IN_STOCK',
  enabled: true,
};

export function MenuPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isStaff = user?.role === 'STAFF';

  const { items, loading } = useMenu();
  const [filter, setFilter] = useState<string>('ALL');
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(
    () => filter === 'ALL' ? items : items.filter(i => i.category === filter),
    [items, filter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const it of filtered) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(item: MenuItem) {
    setForm({
      name: item.name,
      category: item.category,
      price: String(item.price),
      description: item.description ?? '',
      stock: item.stock,
      enabled: item.enabled,
    });
    setEditing(item);
    setCreating(false);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.category.trim() || !form.price) {
      toast.error('Nombre, categoría y precio son obligatorios');
      return;
    }
    const price = Number(form.price);
    if (Number.isNaN(price) || price < 0) {
      toast.error('El precio debe ser un número válido');
      return;
    }

    setSubmitting(true);
    try {
      const data = {
        name: form.name.trim(),
        category: form.category.trim(),
        price,
        description: form.description.trim() || null,
        stock: form.stock,
        enabled: form.enabled,
      };
      if (editing) {
        await menuApi.update(editing.id, data);
        toast.success(`"${data.name}" actualizado`);
      } else {
        await menuApi.create(data);
        toast.success(`"${data.name}" creado`);
      }
      closeForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: MenuItem) {
    const ok = window.confirm(`¿Eliminar "${item.name}" del menú? Esto no afecta el historial de ventas.`);
    if (!ok) return;
    try {
      await menuApi.remove(item.id);
      toast.success(`"${item.name}" eliminado`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar');
    }
  }

  async function handleToggle(item: MenuItem) {
    try {
      await menuApi.toggle(item.id);
      toast.success(`"${item.name}" ${item.enabled ? 'deshabilitado' : 'habilitado'}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleStock(item: MenuItem, stock: StockStatus) {
    try {
      await menuApi.setStock(item.id, stock);
      toast.success(`"${item.name}" → ${STOCK_LABEL[stock]}`);
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
          <h2 className="text-2xl font-semibold tracking-tight">Menú</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? 'ítem' : 'ítems'} en total · Los cambios se ven al instante en la app del mesero
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nuevo ítem
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="Todas" count={items.length} />
        {CATEGORY_OPTIONS.map(c => {
          const count = items.filter(i => i.category === c.value).length;
          if (count === 0) return null;
          return (
            <FilterChip
              key={c.value}
              active={filter === c.value}
              onClick={() => setFilter(c.value)}
              label={c.label}
              count={count}
            />
          );
        })}
      </div>

      {/* Listado agrupado por categoría */}
      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No hay ítems para este filtro
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, list]) => (
            <div key={cat}>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                {categoryLabel(cat)} · {list.length}
              </h3>
              <div className="space-y-2">
                {list.map(item => {
                  const stockStyle = STOCK_STYLE[item.stock];
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center',
                        !item.enabled && 'opacity-60'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{item.name}</p>
                          {!item.enabled && (
                            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-400">
                              Deshabilitado
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-sm">
                          <span className="font-semibold tabular-nums text-emerald-400">
                            {formatMoney(item.price)}
                          </span>
                          <span className={cn(
                            'flex items-center gap-1 text-xs',
                            stockStyle.text
                          )}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', stockStyle.dot)} />
                            {STOCK_LABEL[item.stock]}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Stock quick-select (admin y staff) */}
                        {(isAdmin || isStaff) && (
                          <Select
                            value={item.stock}
                            onChange={(e) => handleStock(item, e.target.value as StockStatus)}
                            className="h-9 w-36 text-xs"
                          >
                            <option value="IN_STOCK">Disponible</option>
                            <option value="LOW_STOCK">Stock bajo</option>
                            <option value="OUT_OF_STOCK">Sin stock</option>
                          </Select>
                        )}
                        {/* Toggle enabled */}
                        {(isAdmin || isStaff) && (
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => handleToggle(item)}
                            title={item.enabled ? 'Deshabilitar' : 'Habilitar'}
                          >
                            {item.enabled ? (
                              <ToggleRight className="h-5 w-5 text-emerald-400" />
                            ) : (
                              <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                            )}
                          </Button>
                        )}
                        {/* Edit / Delete (admin only) */}
                        {isAdmin && (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="Editar">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => handleDelete(item)}
                              title="Eliminar"
                              className="text-rose-400 hover:text-rose-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      <Dialog open={creating || editing !== null} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar ítem' : 'Nuevo ítem'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting}
                placeholder="Pizza Margherita"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="category">Categoría *</Label>
                <Select
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                  disabled={submitting}
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Precio *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                  disabled={submitting}
                  placeholder="18.50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                disabled={submitting}
                placeholder="Mozzarella fresca y albahaca"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="stock">Stock</Label>
                <Select
                  id="stock"
                  value={form.stock}
                  onChange={(e) => setForm(f => ({ ...f, stock: e.target.value as StockStatus }))}
                  disabled={submitting}
                >
                  <option value="IN_STOCK">Disponible</option>
                  <option value="LOW_STOCK">Stock bajo</option>
                  <option value="OUT_OF_STOCK">Sin stock</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visibilidad</Label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                  disabled={submitting}
                  className={cn(
                    'flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors',
                    form.enabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                  )}
                >
                  {form.enabled ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  {form.enabled ? 'Habilitado' : 'Deshabilitado'}
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Guardar' : 'Crear ítem'}
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
      )}>
        {count}
      </span>
    </button>
  );
}
