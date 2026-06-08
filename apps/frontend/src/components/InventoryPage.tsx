// ──────────────────────────────────────────────
// InventoryPage.tsx — Gestión de inventario
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, Search, AlertTriangle, PackagePlus, RefreshCw,
} from 'lucide-react';
import { useInventory } from '../hooks/useInventory';
import {
  inventoryApi, type InventoryItem, type InventoryCategory, ApiError,
} from '../lib/api';
import {
  INVENTORY_CATEGORY_LABEL, INVENTORY_CATEGORY_OPTIONS,
  INVENTORY_CATEGORY_ICON, INVENTORY_CATEGORY_STYLE,
  STOCK_LEVEL_STYLE, stockLevel,
} from '../lib/admin-helpers';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

interface FormState {
  name: string;
  category: InventoryCategory;
  quantity: string;
  unit: string;
  minStock: string;
  supplier: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'FOOD',
  quantity: '',
  unit: '',
  minStock: '',
  supplier: '',
};

export function InventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { items, loading } = useInventory();
  const [filter, setFilter] = useState<InventoryCategory | 'ALL' | 'LOW'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [restocking, setRestocking] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [restockAmount, setRestockAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(item => {
      // Filtro por categoría / stock bajo
      if (filter === 'LOW') {
        const level = stockLevel(item);
        if (level === 'OK') return false;
      } else if (filter !== 'ALL' && item.category !== filter) {
        return false;
      }
      // Búsqueda
      if (s && !item.name.toLowerCase().includes(s) && !(item.supplier ?? '').toLowerCase().includes(s)) {
        return false;
      }
      return true;
    });
  }, [items, filter, search]);

  const lowCount = useMemo(
    () => items.filter(i => stockLevel(i) !== 'OK').length,
    [items]
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(item: InventoryItem) {
    setForm({
      name: item.name,
      category: item.category,
      quantity: String(item.quantity),
      unit: item.unit,
      minStock: String(item.minStock),
      supplier: item.supplier ?? '',
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
    if (!form.name.trim() || !form.unit.trim()) {
      toast.error('Nombre y unidad son obligatorios');
      return;
    }
    const quantity = Number(form.quantity);
    const minStock = form.minStock === '' ? 0 : Number(form.minStock);
    if (Number.isNaN(quantity) || quantity < 0) {
      toast.error('La cantidad debe ser un número ≥ 0');
      return;
    }
    if (Number.isNaN(minStock) || minStock < 0) {
      toast.error('El stock mínimo debe ser ≥ 0');
      return;
    }

    setSubmitting(true);
    try {
      const data = {
        name: form.name.trim(),
        category: form.category,
        quantity,
        unit: form.unit.trim(),
        minStock,
        supplier: form.supplier.trim() || null,
      };
      if (editing) {
        await inventoryApi.update(editing.id, data);
        toast.success(`"${data.name}" actualizado`);
      } else {
        await inventoryApi.create(data);
        toast.success(`"${data.name}" agregado al inventario`);
      }
      closeForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (!window.confirm(`¿Eliminar "${item.name}" del inventario?`)) return;
    try {
      await inventoryApi.remove(item.id);
      toast.success(`"${item.name}" eliminado`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleRestock() {
    if (!restocking) return;
    const amount = Number(restockAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error('Ingresá una cantidad válida');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryApi.restock(restocking.id, amount);
      toast.success(`+${amount} ${restocking.unit} de "${restocking.name}"`);
      setRestocking(null);
      setRestockAmount('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al reabastecer');
    } finally {
      setSubmitting(false);
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
          <h2 className="text-2xl font-semibold tracking-tight">Inventario</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? 'ítem' : 'ítems'} en stock
            {lowCount > 0 && (
              <span className="ml-2 text-amber-400">
                · {lowCount} con stock bajo o agotado
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nuevo ítem
          </Button>
        )}
      </div>

      {/* Alerta global si hay items con stock bajo */}
      {lowCount > 0 && filter !== 'LOW' && (
        <button
          onClick={() => setFilter('LOW')}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-left transition-colors hover:bg-amber-500/10"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-300">
              {lowCount} {lowCount === 1 ? 'ítem necesita' : 'ítems necesitan'} reabastecimiento
            </p>
            <p className="text-xs text-amber-300/70">Tocá para filtrar</p>
          </div>
        </button>
      )}

      {/* Búsqueda + filtros */}
      <div className="mb-6 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o proveedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} label="Todas" count={items.length} />
          <FilterChip
            active={filter === 'LOW'}
            onClick={() => setFilter('LOW')}
            label="⚠ Stock bajo"
            count={lowCount}
            warning
          />
          {INVENTORY_CATEGORY_OPTIONS.map(c => {
            const count = items.filter(i => i.category === c.value).length;
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
      </div>

      {/* Listado de items en grid */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {search ? 'No hay resultados para esa búsqueda' : 'No hay ítems en este filtro'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(item => {
            const level = stockLevel(item);
            const levelStyle = STOCK_LEVEL_STYLE[level];
            const catStyle = INVENTORY_CATEGORY_STYLE[item.category];
            const CatIcon = INVENTORY_CATEGORY_ICON[item.category];
            return (
              <div
                key={item.id}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors',
                  level !== 'OK' ? levelStyle.border : 'border-border'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                    catStyle.border, catStyle.bg, catStyle.text
                  )}>
                    <CatIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {INVENTORY_CATEGORY_LABEL[item.category]}
                      {item.supplier && ` · ${item.supplier}`}
                    </p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    levelStyle.text, levelStyle.bg
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', levelStyle.dot)} />
                    {levelStyle.label}
                  </span>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stock</p>
                    <p className="text-xl font-bold tabular-nums">
                      {item.quantity}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">{item.unit}</span>
                    </p>
                    {item.minStock > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Mín: {item.minStock} {item.unit}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Reabastecido
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(item.lastRestocked)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1 border-t border-border pt-3">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => { setRestocking(item); setRestockAmount(''); }}
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Reabastecer
                  </Button>
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
      )}

      {/* Modal crear/editar */}
      <Dialog open={creating || editing !== null} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar ítem' : 'Nuevo ítem de inventario'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name" value={form.name} autoFocus
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting} placeholder="Tomates"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="category">Categoría *</Label>
                <Select
                  id="category" value={form.category} disabled={submitting}
                  onChange={(e) => setForm(f => ({ ...f, category: e.target.value as InventoryCategory }))}
                >
                  {INVENTORY_CATEGORY_OPTIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unidad *</Label>
                <Input
                  id="unit" value={form.unit}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  disabled={submitting} placeholder="kg, L, caja..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="quantity">Cantidad *</Label>
                <Input
                  id="quantity" type="number" step="0.01" inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))}
                  disabled={submitting} placeholder="45"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minStock">Stock mínimo</Label>
                <Input
                  id="minStock" type="number" step="0.01" inputMode="decimal"
                  value={form.minStock}
                  onChange={(e) => setForm(f => ({ ...f, minStock: e.target.value }))}
                  disabled={submitting} placeholder="20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier">Proveedor</Label>
              <Input
                id="supplier" value={form.supplier}
                onChange={(e) => setForm(f => ({ ...f, supplier: e.target.value }))}
                disabled={submitting} placeholder="Granja Fresca"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal reabastecer */}
      <Dialog open={restocking !== null} onOpenChange={(v) => !v && setRestocking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-400" />
              Reabastecer "{restocking?.name}"
            </DialogTitle>
            <DialogDescription>
              Stock actual: <span className="font-semibold text-foreground">
                {restocking?.quantity} {restocking?.unit}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="restockAmount">Cantidad a sumar</Label>
            <Input
              id="restockAmount" type="number" step="0.01" inputMode="decimal"
              value={restockAmount} autoFocus
              onChange={(e) => setRestockAmount(e.target.value)}
              disabled={submitting}
              placeholder={`Ej: 10 ${restocking?.unit ?? ''}`}
              className="text-lg tabular-nums"
            />
            {restocking && restockAmount && !Number.isNaN(Number(restockAmount)) && (
              <p className="text-xs text-muted-foreground">
                Nuevo total: <span className="font-semibold text-emerald-400">
                  {restocking.quantity + Number(restockAmount)} {restocking.unit}
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestocking(null)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleRestock} disabled={submitting || !restockAmount}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <RefreshCw className="h-4 w-4" />
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count, warning,
}: { active: boolean; onClick: () => void; label: string; count: number; warning?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? warning
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
            : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
          : warning && count > 0
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
            : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      <span className={cn(
        'rounded-full px-1.5 text-[10px] tabular-nums',
        active
          ? warning ? 'bg-amber-500/20' : 'bg-emerald-500/20'
          : 'bg-background/50'
      )}>
        {count}
      </span>
    </button>
  );
}
