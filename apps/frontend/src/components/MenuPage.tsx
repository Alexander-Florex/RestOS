// ──────────────────────────────────────────────
// MenuPage.tsx — CRUD de categorías + menú
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, ToggleLeft, ToggleRight,
  Tag, BookOpen, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useMenu } from '../hooks/useMenu';
import { menuApi, type MenuItem, type StockStatus, ApiError } from '../lib/api';
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { items, loading } = useMenu();

  // Categorías dinámicas: se extraen de los items existentes + las que crea el admin
  const categories = useMemo(() => {
    const set = new Set(items.map(i => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

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
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatValue, setEditCatValue] = useState('');
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
    if (!window.confirm(`¿Eliminar "${item.name}" del menú?`)) return;
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
    // Las categorías son implícitas — se crean agregando un ítem o haciendo un ítem "plantilla"
    // Para el CRUD de categorías, creamos un ítem oculto/deshabilitado como marcador
    // o simplemente guardamos la categoría en un ítem existente.
    // La forma más simple: se agrega directamente como opción — el admin luego le asigna ítems.
    setCatSubmitting(true);
    try {
      // Crear un ítem placeholder deshabilitado para que la categoría exista
      await menuApi.create({
        name:     `[Placeholder ${name}]`,
        category: name,
        price:    0,
        enabled:  false,
      });
      setNewCatName('');
      setCatModalOpen(false);
      toast.success(`Categoría "${name}" creada. Podés asignarle ítems ahora.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    } finally {
      setCatSubmitting(false);
    }
  }

  async function handleRenameCategory() {
    if (!editingCat || !editCatValue.trim()) return;
    const newName = editCatValue.trim();
    if (newName === editingCat) { setEditingCat(null); return; }
    if (categories.includes(newName)) { toast.error('Ya existe una categoría con ese nombre'); return; }

    setCatSubmitting(true);
    const itemsInCat = items.filter(i => i.category === editingCat);
    try {
      // Renombrar la categoría actualizando todos los ítems que la usan
      await Promise.all(itemsInCat.map(i => menuApi.update(i.id, { category: newName })));
      setEditingCat(null);
      setEditCatValue('');
      toast.success(`Categoría renombrada a "${newName}" (${itemsInCat.length} ítems actualizados)`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al renombrar');
    } finally {
      setCatSubmitting(false);
    }
  }

  async function handleDeleteCategory(cat: string) {
    const count = items.filter(i => i.category === cat).length;
    if (count > 0) {
      if (!window.confirm(`La categoría "${cat}" tiene ${count} ítems. ¿Eliminarlos también?`)) return;
      try {
        await Promise.all(items.filter(i => i.category === cat).map(i => menuApi.remove(i.id)));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Error al eliminar ítems'); return;
      }
    }
    toast.success(`Categoría "${cat}" eliminada`);
  }

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Solo los administradores pueden gestionar el menú.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Menú</h2>
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
        <div className="mb-6 rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Tag className="h-4 w-4 text-emerald-400" />
              Categorías del menú
            </h3>
            <Button size="sm" onClick={() => { setNewCatName(''); setCatModalOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Nueva categoría
            </Button>
          </div>

          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay categorías. Creá la primera.</p>
          ) : (
            <div className="space-y-2">
              {categories.map(cat => {
                const count = items.filter(i => i.category === cat).length;
                const isEditing = editingCat === cat;
                return (
                  <div key={cat} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3">
                    <BookOpen className="h-4 w-4 shrink-0 text-emerald-400" />
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editCatValue}
                        onChange={e => setEditCatValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(); if (e.key === 'Escape') setEditingCat(null); }}
                        className="h-8 flex-1 text-sm"
                        disabled={catSubmitting}
                      />
                    ) : (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{cat}</p>
                        <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'ítem' : 'ítems'}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={handleRenameCategory} disabled={catSubmitting}>
                            {catSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCat(null)}>Cancelar</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => { setEditingCat(cat); setEditCatValue(cat); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300"
                            onClick={() => handleDeleteCategory(cat)}>
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
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No hay ítems en esta categoría. Creá el primero con "+ Nuevo ítem".
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
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
                  <tr key={item.id} className={cn('hover:bg-secondary/20', !item.enabled && 'opacity-50')}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-secondary/50 px-2 py-0.5 text-xs">{item.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-400">
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
                          ? <ToggleRight className="mx-auto h-5 w-5 text-emerald-400" />
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
                  className="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background/50 px-3 text-sm"
                  disabled={submitting}>
                  <span>{itemForm.enabled ? 'Activo' : 'Inactivo'}</span>
                  {itemForm.enabled
                    ? <ToggleRight className="h-5 w-5 text-emerald-400" />
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
              <Tag className="h-4 w-4 text-emerald-400" />
              Nueva categoría
            </DialogTitle>
            <DialogDescription>
              Las categorías organizan el menú. Después podés asignarle ítems.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="catName">Nombre de la categoría *</Label>
            <Input id="catName" autoFocus value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
              disabled={catSubmitting} placeholder="Platos principales, Bebidas, Postres..." />
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
        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
        : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
    )}>
      {label}
      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-emerald-500/20' : 'bg-background/50')}>
        {count}
      </span>
    </button>
  );
}
