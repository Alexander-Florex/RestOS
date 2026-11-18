// ──────────────────────────────────────────────
// StockToolsPage.tsx — Stock y compras (fase 3)
//
// - Descontar stock al vender (apagado hasta activarlo).
// - Producción de elaborados (salsas, pastas): descuenta insumos y suma el elaborado.
// - Lista de compras: lo que está bajo el mínimo, por proveedor.
// - Proveedores con contacto.
// - Platos vendidos sin receta (no descuentan stock).
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChefHat, Loader2, Phone, Plus, ShoppingCart, Trash2, Truck } from 'lucide-react';
import {
  stockApi, recipesApi, ApiError, type Recipe, type ShoppingGroup, type Supplier,
} from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ui/confirm-dialog';
import { useInventory } from '../hooks/useInventory';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - n * 86_400_000));
const fmtQty = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });

export function StockToolsPage() {
  const { can } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Carta y stock</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Stock y compras</h2>
      </div>
      {can('inventory.manage') && <AutoStockSetting />}
      {can('inventory.adjust') && <Production />}
      <ShoppingList />
      <Suppliers canEdit={can('inventory.manage')} />
      <Unrecipe />
    </div>
  );
}

function Card({ title, icon: Icon, children, sub }: { title: string; icon: typeof Truck; children: React.ReactNode; sub?: string }) {
  return (
    <section className="glass space-y-3 rounded-3xl p-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-brand-400" /> {title}</h3>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function AutoStockSetting() {
  const confirm = useConfirm();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { stockApi.settings().then(s => setOn(s.autoStockOnSale)).catch(() => setOn(null)); }, []);
  async function toggle() {
    const next = !on;
    if (next && !await confirm({
      title: '¿Descontar stock al vender?',
      description: 'Cada venta va a descontar los insumos según la receta de cada plato. Conviene activarlo con las recetas cargadas y después del primer conteo; si no, el stock va a quedar negativo.',
      confirmLabel: 'Activar',
    })) return;
    try { setOn((await stockApi.setSettings(next)).autoStockOnSale); toast.success(next ? 'Ahora cada venta descuenta stock' : 'Las ventas ya no descuentan stock'); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar'); }
  }
  if (on === null) return null;
  return (
    <Card title="Descontar stock al vender" icon={ChefHat}
      sub="Al cobrar, se descuentan los insumos de cada plato según su receta (también sub-recetas). Vender nunca se bloquea: si falta stock, el saldo queda negativo.">
      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-sm font-medium', on ? 'text-emerald-300' : 'text-muted-foreground')}>{on ? 'Activado' : 'Apagado'}</span>
        <Button variant={on ? 'outline' : 'default'} size="sm" onClick={toggle}>{on ? 'Apagar' : 'Activar'}</Button>
      </div>
    </Card>
  );
}

function Production() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const { items } = useInventory();
  const [recipeId, setRecipeId] = useState('');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { recipesApi.list().then(r => setRecipes(r.recipes.filter(x => x.stockItemId))).catch(() => {}); }, []);
  const recipe = recipes.find(r => String(r.id) === recipeId);
  const output = recipe ? items.find(i => i.id === recipe.stockItemId) : undefined;
  async function produce() {
    const q = Number(qty.replace(',', '.'));
    if (!recipe) { toast.error('Elegí qué se elaboró'); return; }
    if (!Number.isFinite(q) || q <= 0) { toast.error('Poné cuánto se elaboró'); return; }
    setSaving(true);
    try {
      const r = await stockApi.produce(recipe.id, q);
      toast.success(`${fmtQty(r.quantity)} ${r.unit} de ${r.item} al stock (costo ${formatMoney(r.cost)})`);
      if (r.warnings.length) toast.warning(`Algunas líneas no se descontaron: ${r.warnings.join(' · ')}`, { duration: 10_000 });
      setQty('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo registrar');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="Producción" icon={ChefHat}
      sub="Cuando cocina elabora algo que se guarda (salsas, pastas, porciones): descuenta sus insumos y lo suma al stock. Se configura en Recetas → &quot;Produce el insumo&quot;.">
      {recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna receta produce un insumo todavía.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="prodRecipe">Qué se elaboró</Label>
            <Select id="prodRecipe" value={recipeId} onChange={(e) => setRecipeId(e.target.value)} disabled={saving}>
              <option value="">Elegí…</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
          <div className="w-40 space-y-1">
            <Label htmlFor="prodQty">Cantidad {output ? `(${output.unit})` : ''}</Label>
            <Input id="prodQty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={saving} />
          </div>
          <Button onClick={produce} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Registrar</Button>
          {output && <p className="w-full text-xs text-muted-foreground">Hay {fmtQty(output.quantity)} {output.unit} de {output.name}.</p>}
        </div>
      )}
    </Card>
  );
}

function ShoppingList() {
  const [groups, setGroups] = useState<ShoppingGroup[] | null>(null);
  const refresh = useCallback(() => { stockApi.shoppingList().then(r => setGroups(r.groups)).catch(() => setGroups([])); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const socket = getSocket();
    socket.on(SocketEvents.INVENTORY_ITEM_CHANGED, refresh);
    return () => { socket.off(SocketEvents.INVENTORY_ITEM_CHANGED, refresh); };
  }, [refresh]);
  const total = useMemo(() => (groups ?? []).reduce((s, g) => s + g.items.reduce((n, i) => n + i.estimatedCost, 0), 0), [groups]);
  return (
    <Card title="Lista de compras" icon={ShoppingCart}
      sub="Insumos por debajo del mínimo. Se sugiere reponer hasta el doble del mínimo (en presentaciones, si tiene cargada la de compra).">
      {groups === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada por debajo del mínimo. (Para usarla, cargá el stock mínimo de cada insumo en Inventario.)</p>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.supplier?.id ?? 'none'}>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" /> {g.supplier?.name ?? 'Sin proveedor'}
                {g.supplier?.phone && <a href={`tel:${g.supplier.phone}`} className="flex items-center gap-1 text-xs font-normal text-brand-300"><Phone className="h-3 w-3" />{g.supplier.phone}</a>}
              </p>
              <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
                {g.items.map(i => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-medium">{i.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">hay {fmtQty(i.quantity)} {i.unit} · mínimo {fmtQty(i.minStock)}</span>
                    </span>
                    <span className="tabular-nums">
                      {i.presentations && i.purchaseLabel ? `${i.presentations} × ${i.purchaseLabel}` : `${fmtQty(i.suggested)} ${i.unit}`}
                      {i.estimatedCost > 0 && <span className="ml-2 text-xs text-muted-foreground">≈ {formatMoney(i.estimatedCost)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {total > 0 && <p className="text-right text-xs text-muted-foreground">Costo estimado: {formatMoney(total)}</p>}
        </div>
      )}
    </Card>
  );
}

function Suppliers({ canEdit }: { canEdit: boolean }) {
  const confirm = useConfirm();
  const [list, setList] = useState<Supplier[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(() => { stockApi.suppliers().then(r => setList(r.suppliers)).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  async function add() {
    if (!form.name.trim()) { toast.error('Poné el nombre'); return; }
    setSaving(true);
    try {
      await stockApi.createSupplier({ name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null });
      setForm({ name: '', phone: '', email: '' });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }
  async function savePhone(s: Supplier, phone: string) {
    if ((s.phone ?? '') === phone.trim()) return;
    try { await stockApi.updateSupplier(s.id, { phone: phone.trim() || null }); refresh(); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar'); }
  }
  async function remove(s: Supplier) {
    if (!await confirm({ title: `¿Borrar a ${s.name}?`, description: s.itemCount ? `${s.itemCount} insumos quedan sin proveedor.` : undefined, variant: 'destructive', confirmLabel: 'Borrar' })) return;
    try { await stockApi.deleteSupplier(s.id); refresh(); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'No se pudo borrar'); }
  }
  return (
    <Card title="Proveedores" icon={Truck} sub="El proveedor de cada insumo se elige en su ficha (Inventario). Acá se cargan los teléfonos.">
      {list.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
          {list.map(s => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-medium">{s.name}</span><span className="ml-2 text-xs text-muted-foreground">{s.itemCount} insumos</span></span>
              <span className="flex items-center gap-2">
                {canEdit
                  ? <Input className="h-8 w-40" defaultValue={s.phone ?? ''} placeholder="Teléfono" onBlur={(e) => savePhone(s, e.target.value)} />
                  : s.phone && <span className="text-muted-foreground">{s.phone}</span>}
                {canEdit && <Button variant="ghost" size="icon" onClick={() => remove(s)} aria-label={`Borrar ${s.name}`}><Trash2 className="h-4 w-4" /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-40 flex-1" placeholder="Nombre" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} />
          <Input className="w-40" placeholder="Teléfono" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} disabled={saving} />
          <Button onClick={add} disabled={saving}><Plus className="h-4 w-4" /> Agregar</Button>
        </div>
      )}
    </Card>
  );
}

function Unrecipe() {
  const [rows, setRows] = useState<Array<{ name: string; quantity: number }> | null>(null);
  useEffect(() => { stockApi.unrecipeSales(daysAgo(30), today()).then(r => setRows(r.items)).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card title="Platos vendidos sin receta (últimos 30 días)" icon={AlertTriangle}
      sub="No descuentan stock. Cargales la receta en Recetas para que se descuenten.">
      <ul className="flex flex-wrap gap-2 text-sm">
        {rows.map(r => <li key={r.name} className="rounded-full border border-border px-3 py-1">{r.name} <span className="text-muted-foreground">× {r.quantity}</span></li>)}
      </ul>
    </Card>
  );
}
