// ──────────────────────────────────────────────
// RecipesPage.tsx — Recetas y costos
// Calcula el costo de elaboración desde el inventario (costPerUnit) y sugiere
// un precio de venta según %ganancia + IVA, comparándolo contra el MenuItem vinculado.
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Loader2, ChefHat, Trash, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { useRecipes } from '../hooks/useRecipes';
import { useInventory } from '../hooks/useInventory';
import { useMenu } from '../hooks/useMenu';
import {
  recipesApi, type Recipe, type RecipeIngredientBody, ApiError,
} from '../lib/api';
import { formatMoney } from '../lib/format';
import { useConfirm } from './ui/confirm-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

interface IngredientRow {
  inventoryItemId: string;
  quantity: string;
  unit: string;
}

interface FormState {
  name: string;
  menuItemId: string;
  yield: string;
  profitPct: string;
  vatPct: string;
  notes: string;
  ingredients: IngredientRow[];
}

const EMPTY_ROW: IngredientRow = { inventoryItemId: '', quantity: '', unit: '' };
const EMPTY_FORM: FormState = {
  name: '', menuItemId: '', yield: '1', profitPct: '50', vatPct: '21', notes: '',
  ingredients: [{ ...EMPTY_ROW }],
};

export function RecipesPage() {
  const confirm = useConfirm();
  const { recipes, loading, refresh } = useRecipes();
  const { items: inventoryItems } = useInventory();
  const { items: menuItems } = useMenu();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(recipe: Recipe) {
    setForm({
      name: recipe.name,
      menuItemId: recipe.menuItemId ? String(recipe.menuItemId) : '',
      yield: String(recipe.yield),
      profitPct: String(recipe.profitPct * 100),
      vatPct: String(recipe.vatPct * 100),
      notes: recipe.notes ?? '',
      ingredients: recipe.ingredients.map(i => ({
        inventoryItemId: String(i.inventoryItemId), quantity: String(i.quantity), unit: i.unit,
      })),
    });
    setEditing(recipe);
    setModalOpen(true);
  }

  function updateRow(idx: number, patch: Partial<IngredientRow>) {
    setForm(f => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  }

  function addRow() {
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { ...EMPTY_ROW }] }));
  }

  function removeRow(idx: number) {
    setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return; }
    const yieldN = Number(form.yield);
    if (!Number.isInteger(yieldN) || yieldN <= 0) { toast.error('El rendimiento debe ser un entero mayor a 0'); return; }
    const profitPct = Number(form.profitPct);
    const vatPct = Number(form.vatPct);
    if (Number.isNaN(profitPct) || profitPct < 0) { toast.error('% de ganancia inválido'); return; }
    if (Number.isNaN(vatPct) || vatPct < 0) { toast.error('% de IVA inválido'); return; }

    const ingredients: RecipeIngredientBody[] = [];
    for (const row of form.ingredients) {
      if (!row.inventoryItemId) continue;
      const quantity = Number(row.quantity);
      if (Number.isNaN(quantity) || quantity <= 0) { toast.error('Cantidad inválida en un ingrediente'); return; }
      if (!row.unit.trim()) { toast.error('Falta la unidad en un ingrediente'); return; }
      ingredients.push({ inventoryItemId: Number(row.inventoryItemId), quantity, unit: row.unit.trim() });
    }
    if (ingredients.length === 0) { toast.error('Agregá al menos un ingrediente'); return; }

    setSubmitting(true);
    try {
      const data = {
        name: form.name.trim(),
        menuItemId: form.menuItemId ? Number(form.menuItemId) : null,
        yield: yieldN,
        profitPct: profitPct / 100,
        vatPct: vatPct / 100,
        notes: form.notes.trim() || null,
        ingredients,
      };
      if (editing) {
        await recipesApi.update(editing.id, data);
        toast.success(`Receta "${data.name}" actualizada`);
      } else {
        await recipesApi.create(data);
        toast.success(`Receta "${data.name}" creada`);
      }
      setModalOpen(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(recipe: Recipe) {
    if (!await confirm({ title: `¿Eliminar receta "${recipe.name}"?`, variant: 'destructive', confirmLabel: 'Eliminar' })) return;
    try {
      await recipesApi.remove(recipe.id);
      toast.success(`Receta "${recipe.name}" eliminada`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al eliminar');
    }
  }

  const availableInventory = useMemo(
    () => inventoryItems.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [inventoryItems]
  );

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Costos</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Recetas y costos</h2>
          <p className="text-sm text-muted-foreground">{recipes.length} {recipes.length === 1 ? 'receta' : 'recetas'}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva receta
        </Button>
      </div>

      {recipes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-muted-foreground">
          No hay recetas cargadas. Creá la primera para calcular costos y precio sugerido.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recipes.map(recipe => {
            const { cost } = recipe;
            const diff = cost.priceDiff;
            return (
              <div key={recipe.id} className="flex flex-col gap-3 glass rounded-3xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400">
                    <ChefHat className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{recipe.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {recipe.menuItem ? `Vinculada a "${recipe.menuItem.name}"` : 'Sin vincular al menú'}
                      {' · '}Rinde {recipe.yield} {recipe.yield === 1 ? 'porción' : 'porciones'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Costo total</p>
                    <p className="font-semibold tabular-nums">{formatMoney(cost.costTotal)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Costo / porción</p>
                    <p className="font-semibold tabular-nums">{formatMoney(cost.costPerServing)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Precio sugerido</p>
                    <p className="font-semibold tabular-nums text-brand-400">{formatMoney(cost.suggestedPrice)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Precio en menú</p>
                    <p className="font-semibold tabular-nums">
                      {cost.menuItemPrice !== null ? formatMoney(cost.menuItemPrice) : '—'}
                    </p>
                  </div>
                </div>

                {diff !== null && (
                  <div className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium',
                    diff > 0.5 ? 'bg-brand-500/10 text-brand-400'
                      : diff < -0.5 ? 'bg-rose-500/10 text-rose-400'
                      : 'bg-white/[0.06] text-muted-foreground'
                  )}>
                    {diff > 0.5 ? <TrendingUp className="h-3.5 w-3.5" /> : diff < -0.5 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    {diff > 0.5 && `Vendés ${formatMoney(diff)} por encima del sugerido`}
                    {diff < -0.5 && `Vendés ${formatMoney(Math.abs(diff))} por debajo del sugerido`}
                    {diff >= -0.5 && diff <= 0.5 && 'Precio del menú alineado con el sugerido'}
                  </div>
                )}

                <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                  {recipe.ingredients.length} {recipe.ingredients.length === 1 ? 'ingrediente' : 'ingredientes'}
                </div>

                <div className="flex items-center justify-end gap-1 border-t border-border pt-3">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(recipe)} title="Editar">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300"
                    onClick={() => handleDelete(recipe)} title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear/editar receta */}
      <Dialog open={modalOpen} onOpenChange={v => !v && setModalOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar: ${editing.name}` : 'Nueva receta'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rName">Nombre *</Label>
              <Input id="rName" autoFocus value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                disabled={submitting} placeholder="Milanesa napolitana" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rMenuItem">Ítem del menú vinculado</Label>
              <Select id="rMenuItem" value={form.menuItemId}
                onChange={e => setForm(f => ({ ...f, menuItemId: e.target.value }))}
                disabled={submitting}>
                <option value="">— sin vincular —</option>
                {menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rYield">Rinde (porciones)</Label>
                <Input id="rYield" type="number" min="1" step="1" value={form.yield}
                  onChange={e => setForm(f => ({ ...f, yield: e.target.value }))}
                  disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rProfit">% Ganancia</Label>
                <Input id="rProfit" type="number" min="0" step="1" value={form.profitPct}
                  onChange={e => setForm(f => ({ ...f, profitPct: e.target.value }))}
                  disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rVat">% IVA</Label>
                <Input id="rVat" type="number" min="0" step="1" value={form.vatPct}
                  onChange={e => setForm(f => ({ ...f, vatPct: e.target.value }))}
                  disabled={submitting} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ingredientes *</Label>
                <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={submitting}>
                  <Plus className="h-3.5 w-3.5" />
                  Agregar
                </Button>
              </div>
              <div className="space-y-2">
                {form.ingredients.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={row.inventoryItemId}
                      onChange={e => {
                        const inv = availableInventory.find(i => String(i.id) === e.target.value);
                        updateRow(idx, { inventoryItemId: e.target.value, unit: inv ? inv.unit : row.unit });
                      }}
                      disabled={submitting} className="flex-1">
                      <option value="">— insumo —</option>
                      {availableInventory.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </Select>
                    <Input type="number" min="0" step="0.01" value={row.quantity}
                      onChange={e => updateRow(idx, { quantity: e.target.value })}
                      disabled={submitting} placeholder="Cant." className="w-20" />
                    <Input value={row.unit}
                      onChange={e => updateRow(idx, { unit: e.target.value })}
                      disabled={submitting} placeholder="Unidad" className="w-20" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(idx)}
                      disabled={submitting || form.ingredients.length === 1} className="text-rose-400 hover:text-rose-300">
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {availableInventory.length === 0 && (
                <p className="text-xs text-amber-400">No hay ítems de inventario. Cargalos primero en "Inventario".</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="rNotes">Notas</Label>
              <Textarea id="rNotes" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                disabled={submitting} placeholder="Notas de preparación opcionales..." />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Guardar' : 'Crear receta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
