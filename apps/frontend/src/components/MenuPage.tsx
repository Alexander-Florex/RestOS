// ──────────────────────────────────────────────
// MenuPage.tsx — CRUD de categorías + menú
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, ToggleLeft, ToggleRight,
  Tag, BookOpen, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useMenu } from '../hooks/useMenu';
import { useMenuCategories } from '../hooks/useMenuCategories';
import { menuApi, menuCategoriesApi, type MenuItem, type StockStatus, ApiError } from '../lib/api';
import { STOCK_LABEL, STOCK_STYLE } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from './ui/dialog';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ui/confirm-dialog';
import { cn } from '../lib/utils';

// ── Formulario de ítem ──
interface ItemForm {
  name: string;
  category: string;
  price: string;
  description: string;
  stock: StockStatus;
  enabled: boolean;
}

const EMPTY_ITEM: ItemForm = {
  name: '', category: '', price: '', description: '', stock: 'IN_STOCK', enabled: true,
};

export function MenuPage() {
  const { user, can } = useAuth();
  const isAdmin = can('menu.manage');
  const confirm = useConfirm();

  const { items, loading } = useMenu();
  const { categories: categoryEntities, loading: categoriesLoading } = useMenuCategories();

  const categories = useMemo(
    () => categoryEntities.map(c => c.name),
    [categoryEntities]
  );

  // Vista activa: 'menu' | 'categories'
  const [view, setView] = useState<'menu' | 'categories'>('menu');
  const [filterCat, setFilterCat] = useState<string>('ALL');

  // Modal de ítem
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal de categoría
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#10b981');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatValue, setEditCatValue] = useState('');
  const [editCatColor, setEditCatColor] = useState('#10b981');
  const [catSubmitting, setCatSubmitting] = useState(false);

  const filtered = useMemo(
    () => filterCat === 'ALL' ? items : items.filter(i => i.category === filterCat),
    [items, filterCat]
  );

  // ── Handlers de ítem ──
  function openCreateItem() {
    setItemForm({ ...EMPTY_ITEM, category: categories[0] ?? '' });
    setEditingItem(null);
    setItemModalOpen(true);
  }

  function openEditItem(item: MenuItem) {
    setItemForm({
      name:        item.name,
      category:    item.category,
      price:       String(item.price),
      description: item.description ?? '',
      stock:       item.stock as StockStatus,
      enabled:     item.enabled,
    });
    setEditingItem(item);
    setItemModalOpen(true);
  }

  async function handleItemSubmit() {
    if (!itemForm.name.trim() || !itemForm.category || !itemForm.price) {
      toast.error('Nombre, categoría y precio son obligatorios');
      return;
    }
    const price = Number(itemForm.price);
    if (isNaN(price) || price < 0) { toast.error('Precio inválido'); return; }

    setSubmitting(true);
    try {
      const data = {
        name:        itemForm.name.trim(),
        category:    itemForm.category,
        price,
        description: itemForm.description.trim() || undefined,
        stock:       itemForm.stock as StockStatus,
        enabled:     itemForm.enabled,
      };
      if (editingItem) {
        await menuApi.update(editingItem.id, data);
        toast.success(`"${data.name}" actualizado`);
      } else {
        await menuApi.create(data);
        toast.success(`"${data.name}" agregado al menú`);
      }
      setItemModalOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleItem(item: MenuItem) {
    try {
      await menuApi.update(item.id, { enabled: !item.enabled });
      toast.success(`"${item.name}" ${item.enabled ? 'deshabilitado' : 'habilitado'}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  async function handleDeleteItem(item: MenuItem) {
    if (!await confirm({ title: `¿Eliminar "${item.name}"?`, description: 'Se quitará del menú.', variant: 'destructive', confirmLabel: 'Eliminar' })) return;
    try {
      await menuApi.remove(item.id);
      toast.success(`"${item.name}" eliminado`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    }
  }

  // ── Handlers de categoría ──
  async function handleCreateCategory() {
    const name = newCatName.trim();
    if (!name) { toast.error('Ingresá un nombre de categoría'); return; }
    if (categories.includes(name)) { toast.error('Ya existe esa categoría'); return; }

    setCatSubmitting(true);
    try {
      await menuCategoriesApi.create({ name, color: newCatColor, order: categoryEntities.length });
      setNewCatName('');
      setCatModalOpen(false);
      toast.success(`Categoría "${name}" creada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    } finally {
      setCatSubmitting(false);
    }
  }

  async function handleRenameCategory(id: number, oldName: string) {
    const newName = editCatValue.trim();
    if (!newName) return;
    if (newName === oldName && editCatColor === categoryEntities.find(c => c.id === id)?.color) {
      setEditingCatId(null);
      return;
    }
    if (newName !== oldName && categories.includes(newName)) {
      toast.error('Ya existe una categoría con ese nombre'); return;
    }

    setCatSubmitting(true);
    try {
      await menuCategoriesApi.update(id, { name: newName, color: editCatColor });
      setEditingCatId(null);
      setEditCatValue('');
      toast.success(`Categoría actualizada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al actualizar');
    } finally {
      setCatSubmitting(false);
    }
  }

  async function handleDeleteCategory(id: number, name: string) {
    const count = items.filter(i => i.category === name).length;
    if (count > 0) {
      toast.error(`No se puede borrar: "${name}" tiene ${count} ${count === 1 ? 'ítem' : 'ítems'} asignados`);
      return;
    }
    if (!await confirm({ title: `¿Eliminar categoría "${name}"?`, variant: 'destructive', confirmLabel: 'Eliminar' })) return;
    try {
      await menuCategoriesApi.remove(id);
      toast.success(`Categoría "${name}" eliminada`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar');
    }
  }

  async function handleReorderCategory(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= categoryEntities.length) return;
    const a = categoryEntities[index];
    const b = categoryEntities[target];
    try {
      await Promise.all([
        menuCategoriesApi.update(a.id, { order: b.order }),
        menuCategoriesApi.update(b.id, { order: a.order }),
      ]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al reordenar');
    }
  }

  if (!isAdmin) {
    return (
      <div className="glass rounded-3xl p-12 text-center">
        <p className="text-sm text-muted-foreground">Tu rol no tiene permiso para editar la carta.</p>
      </div>
    );
  }

  if (loading || categoriesLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Carta y stock</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Menú</h2>
          <p className="text-sm text-muted-foreground">
            {items.filter(i => i.enabled).length} ítems activos · {categories.length} categorías
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={view === 'categories' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView(v => v === 'categories' ? 'menu' : 'categories')}
          >
            <Tag className="h-4 w-4" />
            Categorías
          </Button>
          <Button size="sm" onClick={openCreateItem}>
            <Plus className="h-4 w-4" />
            Nuevo ítem
          </Button>
        </div>
      </div>

      {/* VISTA CATEGORÍAS */}
      {view === 'categories' && (
        <div className="mb-6 glass rounded-3xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Tag className="h-4 w-4 text-brand-400" />
              Categorías del menú
            </h3>
            <Button size="sm" onClick={() => { setNewCatName(''); setCatModalOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Nueva categoría
            </Button>
          </div>

          {categoryEntities.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay categorías. Creá la primera.</p>
          ) : (
            <div className="space-y-2">
              {categoryEntities.map((cat, idx) => {
                const count = items.filter(i => i.category === cat.name).length;
                const isEditing = editingCatId === cat.id;
                return (
                  <div key={cat.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => handleReorderCategory(idx, -1)} disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleReorderCategory(idx, 1)} disabled={idx === categoryEntities.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                    {isEditing ? (
                      <input type="color" value={editCatColor} onChange={e => setEditCatColor(e.target.value)}
                        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                    )}
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editCatValue}
                        onChange={e => setEditCatValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id, cat.name); if (e.key === 'Escape') setEditingCatId(null); }}
                        className="h-8 flex-1 text-sm"
                        disabled={catSubmitting}
                      />
                    ) : (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{cat.name}</p>
                        <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'ítem' : 'ítems'}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={() => handleRenameCategory(cat.id, cat.name)} disabled={catSubmitting}>
                            {catSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)}>Cancelar</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon"
                            onClick={() => { setEditingCatId(cat.id); setEditCatValue(cat.name); setEditCatColor(cat.color); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300"
                            onClick={() => handleDeleteCategory(cat.id, cat.name)}>
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
        </div>
      )}

      {/* Filtro por categoría */}
      <div className="mb-4 flex flex-wrap gap-2">
        <CatChip active={filterCat === 'ALL'} onClick={() => setFilterCat('ALL')} label="Todos" count={items.length} />
        {categories.map(cat => (
          <CatChip key={cat} active={filterCat === cat} onClick={() => setFilterCat(cat)}
            label={cat} count={items.filter(i => i.category === cat).length} />
        ))}
      </div>

      {/* Tabla de ítems */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
          No hay ítems en esta categoría. Creá el primero con "+ Nuevo ítem".
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nombre</th>
                <th className="px-4 py-3 text-left font-medium">Categoría</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 text-center font-medium">Stock</th>
                <th className="px-4 py-3 text-center font-medium">Activo</th>
                <th className="px-4 py-3 text-center font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => {
                const ss = STOCK_STYLE[item.stock as StockStatus];
                return (
                  <tr key={item.id} className={cn('hover:bg-white/[0.025]', !item.enabled && 'opacity-50')}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs">{item.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-400">
                      {formatMoney(item.price)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider', ss.text, ss.bg)}>
                        {STOCK_LABEL[item.stock as StockStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleItem(item)}>
                        {item.enabled
                          ? <ToggleRight className="mx-auto h-5 w-5 text-brand-400" />
                          : <ToggleLeft className="mx-auto h-5 w-5 text-muted-foreground" />
                        }
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditItem(item)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300" onClick={() => handleDeleteItem(item)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nuevo/editar ítem */}
      <Dialog open={itemModalOpen} onOpenChange={v => !v && setItemModalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? `Editar: ${editingItem.name}` : 'Nuevo ítem del menú'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="iName">Nombre *</Label>
              <Input id="iName" autoFocus value={itemForm.name}
                onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting} placeholder="Bife de chorizo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="iCat">Categoría *</Label>
                <Select id="iCat" value={itemForm.category}
                  onChange={e => setItemForm(f => ({ ...f, category: e.target.value }))}
                  disabled={submitting}>
                  <option value="">— elegir —</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
                {categories.length === 0 && (
                  <p className="text-xs text-amber-400">Creá una categoría primero desde "Categorías"</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="iPrice">Precio *</Label>
                <Input id="iPrice" type="number" min="0" step="0.01" inputMode="decimal"
                  value={itemForm.price}
                  onChange={e => setItemForm(f => ({ ...f, price: e.target.value }))}
                  disabled={submitting} placeholder="1500" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="iDesc">Descripción</Label>
              <Textarea id="iDesc" rows={2} value={itemForm.description}
                onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))}
                disabled={submitting} placeholder="Descripción opcional..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="iStock">Stock</Label>
                <Select id="iStock" value={itemForm.stock}
                  onChange={e => setItemForm(f => ({ ...f, stock: e.target.value as StockStatus }))}
                  disabled={submitting}>
                  <option value="IN_STOCK">Disponible</option>
                  <option value="LOW_STOCK">Stock bajo</option>
                  <option value="OUT_OF_STOCK">Sin stock</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <button type="button"
                  onClick={() => setItemForm(f => ({ ...f, enabled: !f.enabled }))}
                  className="flex h-10 w-full items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm"
                  disabled={submitting}>
                  <span>{itemForm.enabled ? 'Activo' : 'Inactivo'}</span>
                  {itemForm.enabled
                    ? <ToggleRight className="h-5 w-5 text-brand-400" />
                    : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                  }
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemModalOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleItemSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingItem ? 'Guardar' : <><Plus className="h-4 w-4" /> Crear ítem</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal nueva categoría */}
      <Dialog open={catModalOpen} onOpenChange={v => !v && setCatModalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-brand-400" />
              Nueva categoría
            </DialogTitle>
            <DialogDescription>
              Las categorías organizan el menú. Después podés asignarle ítems.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="catName">Nombre de la categoría *</Label>
              <Input id="catName" autoFocus value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
                disabled={catSubmitting} placeholder="Platos principales, Bebidas, Postres..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="catColor">Color</Label>
              <input id="catColor" type="color" value={newCatColor}
                onChange={e => setNewCatColor(e.target.value)}
                disabled={catSubmitting}
                className="h-10 w-14 cursor-pointer rounded-xl border border-border bg-transparent" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatModalOpen(false)} disabled={catSubmitting}>Cancelar</Button>
            <Button onClick={handleCreateCategory} disabled={catSubmitting || !newCatName.trim()}>
              {catSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatChip({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number;
}) {
  return (
    <button onClick={onClick} className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      active
        ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
        : 'border-border bg-white/[0.06] text-muted-foreground hover:text-foreground'
    )}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-brand-500/20' : 'bg-white/[0.03]')}>
        {count}
      </span>
    </button>
  );
}
