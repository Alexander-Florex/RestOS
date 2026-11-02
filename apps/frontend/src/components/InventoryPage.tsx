// ──────────────────────────────────────────────
// InventoryPage.tsx — Gestión de inventario
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, Search, AlertTriangle, PackagePlus, RefreshCw, History,
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
import { formatDateTime, formatMoney } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ui/confirm-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';
import { canConvert, convertUnits, FAMILY_LABEL, normalizeUnit, unitFamily, UNIT_LIST, UNITS } from '@shared/units';
import { PriceHistoryDialog } from './PriceHistoryDialog';
import { recipesApi } from '../lib/api';

interface FormState {
  name: string;
  category: InventoryCategory;
  quantity: string;
  unit: string;
  minStock: string;
  costPerUnit: string;
  supplier: string;
  /** Equivalencia opcional: 1 <unit> = eqQty <eqUnit> */
  eqQty: string;
  eqUnit: string;
  /** Presentación de compra (tarea 2.2) */
  pQty: string;
  pUnit: string;
  pPrice: string;
  /** Merma por defecto, en % (tarea 2.4) */
  wastePct: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'FOOD',
  quantity: '',
  unit: '',
  minStock: '',
  costPerUnit: '',
  supplier: '',
  eqQty: '',
  eqUnit: 'g',
  pQty: '',
  pUnit: '',
  pPrice: '',
  wastePct: '',
};

/** Costo por unidad que sale de la presentación, o null si falta algo o no convierte. */
function presentationCost(form: FormState): number | null {
  const qty = Number(form.pQty); const price = Number(form.pPrice);
  const pUnit = form.pUnit || normalizeUnit(form.unit);
  if (!form.pQty || !form.pPrice || !pUnit || !(qty > 0) || !(price >= 0)) return null;
  const eq = form.eqQty ? { qty: Number(form.eqQty), unit: equivalenceUnits(form).selected } : null;
  try {
    const inItemUnit = convertUnits(qty, pUnit, form.unit, { itemUnit: form.unit, eq });
    return inItemUnit > 0 ? price / inItemUnit : null;
  } catch { return null; }
}

/** Unidades en que se puede expresar la presentación (convertibles a la del insumo). */
function presentationUnits(form: FormState): string[] {
  if (!normalizeUnit(form.unit)) return [];
  const eq = form.eqQty ? { qty: Number(form.eqQty), unit: equivalenceUnits(form).selected } : null;
  return UNIT_LIST.filter(u => canConvert(u, form.unit, { itemUnit: form.unit, eq }));
}

/** Unidades válidas para la equivalencia (las de otra familia) y la elegida en el formulario. */
function equivalenceUnits(form: FormState) {
  const unit = normalizeUnit(form.unit);
  if (!unit) return { others: [] as string[], selected: '' };
  const others = UNIT_LIST.filter(u => UNITS[u].family !== unitFamily(unit));
  return { others, selected: (others as string[]).includes(form.eqUnit) ? form.eqUnit : others[0] };
}

/** Después de subir un costo: cuántos platos quedan por debajo del margen objetivo. */
async function warnCostIncrease(itemId: number, name: string) {
  try {
    const { alerts } = await recipesApi.costAlerts(1);
    const alert = alerts.find(a => a.inventoryItemId === itemId);
    if (!alert || alert.dishes.length === 0) return;
    const below = alert.dishes.filter(d => d.belowTarget);
    toast.warning(`Subió el costo de "${name}": afecta ${alert.dishes.length} ${alert.dishes.length === 1 ? 'plato' : 'platos'}`, {
      description: below.length
        ? `${below.map(d => d.menuItemName).join(', ')} ${below.length === 1 ? 'quedó' : 'quedaron'} debajo del margen objetivo. Mirá los precios sugeridos en Recetas.`
        : 'Todos siguen dentro del margen objetivo. El detalle está en Recetas.',
      duration: 12000,
    });
  } catch { /* sin permiso de recetas: no se avisa */ }
}

export function InventoryPage() {
  const { user, can } = useAuth();
  const isAdmin = can('inventory.manage');
  const canAdjust = can('inventory.adjust');
  const confirm = useConfirm();

  const { items, loading } = useInventory();
  const [filter, setFilter] = useState<InventoryCategory | 'ALL' | 'LOW'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [restocking, setRestocking] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [restockAmount, setRestockAmount] = useState('');
  // Reposición en presentaciones (ej. 2 bolsas) y precio nuevo de la presentación
  const [restockByPresentation, setRestockByPresentation] = useState(false);
  const [restockPrice, setRestockPrice] = useState('');
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
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
      costPerUnit: item.costPerUnit,
      supplier: item.supplier ?? '',
      eqQty: item.equivalenceQty != null ? String(item.equivalenceQty) : '',
      eqUnit: item.equivalenceUnit ?? 'g',
      pQty: item.purchaseQty != null ? String(item.purchaseQty) : '',
      pUnit: item.purchaseUnit ?? '',
      pPrice: item.purchasePrice != null ? String(Number(item.purchasePrice)) : '',
      wastePct: item.wastePct ? String(Math.round(item.wastePct * 1000) / 10) : '',
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
    const costPerUnit = form.costPerUnit === '' ? 0 : Number(form.costPerUnit);
    if (Number.isNaN(costPerUnit) || costPerUnit < 0) {
      toast.error('El costo por unidad debe ser ≥ 0');
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
        costPerUnit,
        supplier: form.supplier.trim() || null,
        // Vacío = sin equivalencia
        equivalenceQty: form.eqQty === '' ? null : Number(form.eqQty),
        equivalenceUnit: form.eqQty === '' ? null : equivalenceUnits(form).selected,
        // Presentación: los tres juntos o ninguno (sin presentación, vale el costo a mano)
        purchaseQty: form.pQty === '' ? null : Number(form.pQty),
        purchaseUnit: form.pQty === '' ? null : (form.pUnit || normalizeUnit(form.unit)),
        purchasePrice: form.pQty === '' ? null : Number(form.pPrice || 0),
        wastePct: form.wastePct === '' ? 0 : Number(form.wastePct) / 100,
      };
      if (editing) {
        const { item: saved } = await inventoryApi.update(editing.id, data);
        toast.success(`"${data.name}" actualizado`);
        // Subió el costo: avisar si algún plato pierde margen (tarea 2.8)
        if (Number(saved.costPerUnit) > Number(editing.costPerUnit)) void warnCostIncrease(saved.id, saved.name);
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
    if (!await confirm({ title: `¿Eliminar "${item.name}"?`, description: 'Se quitará del inventario.', variant: 'destructive', confirmLabel: 'Eliminar' })) return;
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
      const byPres = restockByPresentation && restocking.purchaseQty !== null;
      const newPrice = byPres && restockPrice !== '' && Number(restockPrice) !== Number(restocking.purchasePrice) ? Number(restockPrice) : undefined;
      await inventoryApi.restockWith(restocking.id, byPres ? { presentations: amount, purchasePrice: newPrice } : { amount });
      toast.success(byPres
        ? `+${amount} × ${restocking.purchaseQty} ${restocking.purchaseUnit} de "${restocking.name}"${newPrice !== undefined ? ' (precio actualizado)' : ''}`
        : `+${amount} ${restocking.unit} de "${restocking.name}"`);
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Carta y stock</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Inventario</h2>
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
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
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
                    {Number(item.costPerUnit) > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatMoney(item.costPerUnit)} / {item.unit}
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
                  {canAdjust && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => {
                        setRestocking(item); setRestockAmount('');
                        setRestockByPresentation(item.purchaseQty !== null);
                        setRestockPrice(item.purchasePrice != null ? String(Number(item.purchasePrice)) : '');
                      }}
                    >
                      <PackagePlus className="h-3.5 w-3.5" />
                      Reabastecer
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setHistoryItem(item)} title="Historial de precios" aria-label={`Historial de precios de ${item.name}`}>
                    <History className="h-4 w-4" />
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
                <Select
                  id="unit" value={form.unit}
                  onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                  disabled={submitting}
                >
                  <option value="" disabled>Elegí la unidad</option>
                  {/* Unidad vieja que no se reconoce: se muestra para poder corregirla */}
                  {form.unit && !normalizeUnit(form.unit) && <option value={form.unit}>{form.unit} (revisar)</option>}
                  {UNIT_LIST.map(u => <option key={u} value={u}>{UNITS[u].label}</option>)}
                </Select>
              </div>
            </div>

            {/* Equivalencia entre familias (tarea 2.1): ej. huevo en "un" usado en recetas en gramos */}
            {normalizeUnit(form.unit) && (() => {
              const fam = unitFamily(normalizeUnit(form.unit)!);
              const { others, selected } = equivalenceUnits(form);
              return (
                <div className="space-y-2">
                  <Label htmlFor="eqQty">Equivalencia (opcional)</Label>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="shrink-0 text-muted-foreground">1 {normalizeUnit(form.unit)} =</span>
                    <Input id="eqQty" type="number" step="0.01" min="0" inputMode="decimal" className="w-24"
                      value={form.eqQty} onChange={(e) => setForm(f => ({ ...f, eqQty: e.target.value }))}
                      disabled={submitting} placeholder="60" />
                    <Select value={selected}
                      onChange={(e) => setForm(f => ({ ...f, eqUnit: e.target.value }))} disabled={submitting} aria-label="Unidad de la equivalencia">
                      {others.map(u => <option key={u} value={u}>{UNITS[u as keyof typeof UNITS].label}</option>)}
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Para usarlo en recetas medido en otra familia ({FAMILY_LABEL[fam]} ↔ otra). Ej.: 1 un = 60 g.
                  </p>
                </div>
              );
            })()}

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

            {/* Presentación de compra (tarea 2.2): el costo por unidad sale de acá */}
            {normalizeUnit(form.unit) && (
              <div className="space-y-2">
                <Label htmlFor="pQty">Presentación de compra (opcional)</Label>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Input id="pQty" type="number" step="0.01" min="0" inputMode="decimal" className="w-24"
                    value={form.pQty} onChange={(e) => setForm(f => ({ ...f, pQty: e.target.value }))}
                    disabled={submitting} placeholder="25" />
                  <Select value={form.pUnit || normalizeUnit(form.unit)!} aria-label="Unidad de la presentación"
                    onChange={(e) => setForm(f => ({ ...f, pUnit: e.target.value }))} disabled={submitting}>
                    {presentationUnits(form).map(u => <option key={u} value={u}>{UNITS[u as keyof typeof UNITS].label}</option>)}
                  </Select>
                  <span className="text-muted-foreground">a $</span>
                  <Input type="number" step="0.01" min="0" inputMode="decimal" className="w-28" aria-label="Precio de la presentación"
                    value={form.pPrice} onChange={(e) => setForm(f => ({ ...f, pPrice: e.target.value }))}
                    disabled={submitting} placeholder="25000" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Ej.: bolsa de 25 kg a $25.000. {presentationCost(form) !== null
                    ? <>Costo: <span className="font-semibold text-brand-400">{formatMoney(presentationCost(form)!)} / {normalizeUnit(form.unit)}</span></>
                    : 'Si la cargás, el costo por unidad se calcula solo.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="costPerUnit">Costo por {normalizeUnit(form.unit) ?? 'unidad'}</Label>
                <Input
                  id="costPerUnit" type="number" step="0.0001" inputMode="decimal"
                  value={form.pQty ? (presentationCost(form)?.toFixed(4) ?? '') : form.costPerUnit}
                  onChange={(e) => setForm(f => ({ ...f, costPerUnit: e.target.value }))}
                  disabled={submitting || form.pQty !== ''}
                  placeholder={form.pQty ? 'Sale de la presentación' : 'Usado en Recetas'}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wastePct">Merma %</Label>
                <Input
                  id="wastePct" type="number" step="0.5" min="0" max="95" inputMode="decimal"
                  value={form.wastePct}
                  onChange={(e) => setForm(f => ({ ...f, wastePct: e.target.value }))}
                  disabled={submitting} placeholder="Ej. 20 al limpiar"
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

      <PriceHistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />

      {/* Modal reabastecer */}
      <Dialog open={restocking !== null} onOpenChange={(v) => !v && setRestocking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-brand-400" />
              Reabastecer "{restocking?.name}"
            </DialogTitle>
            <DialogDescription>
              Stock actual: <span className="font-semibold text-foreground">
                {restocking?.quantity} {restocking?.unit}
              </span>
            </DialogDescription>
          </DialogHeader>

          {restocking?.purchaseQty != null && (
            <div className="flex gap-1.5">
              {[[true, `En presentaciones (${restocking.purchaseQty} ${restocking.purchaseUnit})`], [false, `En ${restocking.unit}`]].map(([v, label]) => (
                <button key={String(v)} type="button" onClick={() => setRestockByPresentation(v as boolean)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-medium',
                    restockByPresentation === v ? 'border-brand-500/50 bg-brand-500/10 text-brand-400' : 'border-border text-muted-foreground')}>
                  {label as string}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="restockAmount">{restockByPresentation && restocking?.purchaseQty != null ? 'Cantidad de presentaciones' : 'Cantidad a sumar'}</Label>
            <Input
              id="restockAmount" type="number" step="0.01" inputMode="decimal"
              value={restockAmount} autoFocus
              onChange={(e) => setRestockAmount(e.target.value)}
              disabled={submitting}
              placeholder={`Ej: 10 ${restocking?.unit ?? ''}`}
              className="text-lg tabular-nums"
            />
            {restocking && restockAmount && !Number.isNaN(Number(restockAmount)) && (() => {
              let added = Number(restockAmount);
              if (restockByPresentation && restocking.purchaseQty != null) {
                try {
                  added = convertUnits(added * restocking.purchaseQty, restocking.purchaseUnit!, restocking.unit, {
                    itemUnit: restocking.unit,
                    eq: restocking.equivalenceQty && restocking.equivalenceUnit ? { qty: restocking.equivalenceQty, unit: restocking.equivalenceUnit } : null,
                  });
                } catch { return null; }
              }
              return (
                <p className="text-xs text-muted-foreground">
                  Nuevo total: <span className="font-semibold text-brand-400">
                    {Math.round((restocking.quantity + added) * 1000) / 1000} {restocking.unit}
                  </span>
                </p>
              );
            })()}
          </div>
          {restockByPresentation && restocking?.purchaseQty != null && (
            <div className="space-y-2">
              <Label htmlFor="restockPrice">Precio de la presentación</Label>
              <Input id="restockPrice" type="number" step="0.01" min="0" inputMode="decimal"
                value={restockPrice} onChange={(e) => setRestockPrice(e.target.value)} disabled={submitting} />
              <p className="text-xs text-muted-foreground">Si llegó con otro precio, cambialo: se actualiza el costo y queda en el historial.</p>
            </div>
          )}

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
            : 'border-brand-500/50 bg-brand-500/10 text-brand-400'
          : warning && count > 0
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
            : 'border-border bg-white/[0.06] text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      <span className={cn(
        'rounded-full px-1.5 text-[10px] tabular-nums',
        active
          ? warning ? 'bg-amber-500/20' : 'bg-brand-500/20'
          : 'bg-white/[0.03]'
      )}>
        {count}
      </span>
    </button>
  );
}
