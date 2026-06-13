// ──────────────────────────────────────────────
// WaiterMobileView.tsx — Vista del mesero (móvil)
//
// Flujo:
// 1. Lista de mesas → tap en una
// 2. Si está libre: pide cantidad de comensales
// 3. Selecciona items del menú con + / −
// 4. Botón flotante "Enviar pedido" → POST /api/orders
// 5. Vuelve a la lista
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChefHat, LogOut, ArrowLeft, Send, Loader2, Minus, Plus,
  Users, Clock, ShoppingBag, X, Printer,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTables, useTick } from '../hooks/useTables';
import { useMenu } from '../hooks/useMenu';
import { useTableOrders } from '../hooks/useTableOrders';
import { ordersApi, printingApi, type MenuItem, type Table, ApiError } from '../lib/api';
import {
  TABLE_STATUS_LABEL, TABLE_STATUS_STYLE, elapsedSince,
} from '../lib/table-helpers';
import { categoryLabel, CATEGORY_OPTIONS } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { PrintButton, printerPrefs } from './PrintButton';
import { cn } from '../lib/utils';

type Step = 'tables' | 'guests' | 'menu';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export function WaiterMobileView() {
  const { user, logout } = useAuth();
  const { tables, loading: loadingTables } = useTables();
  const { items: menu, loading: loadingMenu } = useMenu({ onlyEnabled: true });

  const [step, setStep] = useState<Step>('tables');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [guestCount, setGuestCount] = useState(1);
  const [cart, setCart] = useState<Map<number, CartItem>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('main-dishes');
  // ID del último pedido enviado (para imprimir)
  const [lastOrderId, setLastOrderId] = useState<number | null>(null);

  useTick(30_000);

  // Pedidos previos de la mesa (para mostrar lo que ya tomó)
  const { orders: previousOrders } = useTableOrders(
    selectedTable && selectedTable.status !== 'AVAILABLE' ? selectedTable.id : null
  );

  // Categorías disponibles (con items) en este menú
  const categories = useMemo(() => {
    const set = new Set(menu.map(m => m.category));
    return CATEGORY_OPTIONS.filter(c => set.has(c.value));
  }, [menu]);

  const filteredMenu = useMemo(
    () => menu.filter(m => m.category === activeCategory && m.stock !== 'OUT_OF_STOCK'),
    [menu, activeCategory]
  );

  const cartTotal = useMemo(() => {
    let total = 0;
    for (const ci of cart.values()) total += Number(ci.menuItem.price) * ci.quantity;
    return total;
  }, [cart]);

  const cartCount = useMemo(() => {
    let count = 0;
    for (const ci of cart.values()) count += ci.quantity;
    return count;
  }, [cart]);

  function selectTable(t: Table) {
    if (t.status === 'RESERVED') {
      toast.error('Esta mesa está reservada. Avisá al admin para abrirla.');
      return;
    }
    if (!t.enabled) {
      toast.error('Esta mesa está deshabilitada.');
      return;
    }
    setSelectedTable(t);
    setCart(new Map());
    if (t.status === 'AVAILABLE') {
      // Inicia en 1 para no asumir cuántos son; el mesero lo ajusta
      setGuestCount(Math.min(1, t.capacity));
      setStep('guests');
    } else {
      setStep('menu');
    }
  }

  function backToTables() {
    setStep('tables');
    setSelectedTable(null);
    setCart(new Map());
  }

  function adjustQty(item: MenuItem, delta: number) {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(item.id);
      const newQty = (current?.quantity ?? 0) + delta;
      if (newQty <= 0) {
        next.delete(item.id);
      } else {
        next.set(item.id, { menuItem: item, quantity: newQty });
      }
      return next;
    });
  }

  async function sendOrder() {
    if (!selectedTable || cart.size === 0) return;
    setSubmitting(true);
    try {
      const { order } = await ordersApi.create({
        tableId: selectedTable.id,
        guestCount: selectedTable.status === 'AVAILABLE' ? guestCount : undefined,
        items: Array.from(cart.values()).map(ci => ({
          menuItemId: ci.menuItem.id,
          quantity: ci.quantity,
        })),
      });
      setLastOrderId(order.id);
      toast.success(`Pedido enviado a mesa ${selectedTable.number}`, {
        description: printerPrefs.getPrinter() ? 'Podés imprimir la comanda abajo' : undefined,
        duration: 4000,
      });
      backToTables();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al enviar el pedido');
    } finally {
      setSubmitting(false);
    }
  }

  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          {step === 'tables' ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <ChefHat className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">RestOS · Mesero</p>
                <p className="text-[11px] text-muted-foreground leading-tight">{user?.name}</p>
              </div>
            </div>
          ) : (
            <button
              onClick={backToTables}
              className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>
          )}

          {step === 'tables' && (
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </Button>
          )}

          {selectedTable && step !== 'tables' && (
            <div className="text-right">
              <p className="text-[11px] text-muted-foreground leading-tight">Mesa</p>
              <p className="text-lg font-bold leading-tight text-emerald-400">
                {String(selectedTable.number).padStart(2, '0')}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Contenido por paso */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {step === 'tables' && (
          <>
            <TablesList tables={tables} loading={loadingTables} onSelect={selectTable} />

            {/* Banner: imprimir el último pedido enviado */}
            {lastOrderId !== null && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <Printer className="h-5 w-5 shrink-0 text-emerald-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Pedido #{lastOrderId} enviado</p>
                  <p className="text-xs text-muted-foreground">¿Querés imprimir la comanda?</p>
                </div>
                <PrintButton
                  label="Imprimir"
                  size="sm"
                  onPrint={(printerName, restaurantName) =>
                    printingApi.printOrder(lastOrderId, { printerName, restaurantName }).then(() => {})
                  }
                />
                <button
                  onClick={() => setLastOrderId(null)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}

        {step === 'guests' && selectedTable && (
          <GuestStep
            table={selectedTable}
            guestCount={guestCount}
            onChange={setGuestCount}
            onConfirm={() => setStep('menu')}
          />
        )}

        {step === 'menu' && selectedTable && (
          <MenuStep
            menu={filteredMenu}
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            cart={cart}
            onAdjust={adjustQty}
            loading={loadingMenu}
            previousItemsCount={previousOrders.flatMap(o => o.items).length}
          />
        )}
      </main>

      {/* Botón flotante "Enviar pedido" */}
      {step === 'menu' && cartCount > 0 && (
        <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <Button
            className="h-14 w-full text-base"
            onClick={sendOrder}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
            <div className="flex flex-1 items-center justify-between">
              <span>Enviar pedido ({cartCount} {cartCount === 1 ? 'ítem' : 'ítems'})</span>
              <span className="tabular-nums">{formatMoney(cartTotal)}</span>
            </div>
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-componentes
// ──────────────────────────────────────────────

function TablesList({
  tables, loading, onSelect,
}: { tables: Table[]; loading: boolean; onSelect: (t: Table) => void }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        Tocá una mesa para tomar pedido
      </p>
      {tables.map(t => {
        const style = TABLE_STATUS_STYLE[t.status];
        const elapsed = elapsedSince(t.openedAt);
        const isDisabled = t.status === 'RESERVED';
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            disabled={isDisabled}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors',
              style.border, style.bg,
              isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.01] active:scale-100'
            )}
          >
            <div className={cn(
              'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 text-xl font-bold tabular-nums',
              style.border, style.bg, style.text
            )}>
              {String(t.number).padStart(2, '0')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                <span className={cn('text-xs font-medium uppercase tracking-wider', style.text)}>
                  {TABLE_STATUS_LABEL[t.status]}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {t.guestCount !== null ? `${t.guestCount}/${t.capacity}` : t.capacity}
                </span>
                {elapsed && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {elapsed}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function GuestStep({
  table, guestCount, onChange, onConfirm,
}: {
  table: Table;
  guestCount: number;
  onChange: (n: number) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <h2 className="text-xl font-semibold">Mesa N° {table.number}</h2>
      <p className="mt-1 text-sm text-muted-foreground">¿Cuántos comensales son?</p>

      <div className="my-8 flex items-center gap-4">
        <button
          onClick={() => onChange(Math.max(1, guestCount - 1))}
          disabled={guestCount <= 1}
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          <Minus className="h-5 w-5" />
        </button>

        <div className="flex h-28 w-28 items-center justify-center rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5">
          <span className="text-5xl font-bold text-emerald-400 tabular-nums">{guestCount}</span>
        </div>

        <button
          onClick={() => onChange(Math.min(table.capacity, guestCount + 1))}
          disabled={guestCount >= table.capacity}
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">Capacidad: {table.capacity} personas</p>

      <Button className="mt-8 h-12 w-full max-w-xs" onClick={onConfirm}>
        Continuar al menú
      </Button>
    </div>
  );
}

function MenuStep({
  menu, categories, activeCategory, onCategoryChange,
  cart, onAdjust, loading, previousItemsCount,
}: {
  menu: MenuItem[];
  categories: ReadonlyArray<{ value: string; label: string }>;
  activeCategory: string;
  onCategoryChange: (c: string) => void;
  cart: Map<number, { menuItem: MenuItem; quantity: number }>;
  onAdjust: (item: MenuItem, delta: number) => void;
  loading: boolean;
  previousItemsCount: number;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {previousItemsCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-300">
          <ShoppingBag className="h-3.5 w-3.5" />
          Esta mesa ya tiene {previousItemsCount} ítems pedidos. Lo que sumés será un pedido nuevo.
        </div>
      )}

      {/* Tabs de categorías — scroll horizontal */}
      <div className="-mx-4 mb-3 overflow-x-auto px-4">
        <div className="flex gap-2 whitespace-nowrap pb-1">
          {categories.map(cat => (
            <button
              key={cat.value}
              onClick={() => onCategoryChange(cat.value)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                activeCategory === cat.value
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-secondary/30 text-muted-foreground'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de items */}
      <div className="space-y-2 pb-24">
        {menu.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay items en {categoryLabel(activeCategory)}
          </p>
        ) : (
          menu.map(item => {
            const inCart = cart.get(item.id);
            const qty = inCart?.quantity ?? 0;
            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                  qty > 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.description ?? '—'}
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-400">
                    {formatMoney(item.price)}
                  </p>
                  {item.stock === 'LOW_STOCK' && (
                    <p className="text-[10px] uppercase tracking-wider text-amber-400 mt-0.5">
                      ⚠ Stock bajo
                    </p>
                  )}
                </div>

                {qty === 0 ? (
                  <button
                    onClick={() => onAdjust(item, 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600"
                    aria-label="Agregar"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onAdjust(item, -1)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary hover:bg-secondary/80"
                      aria-label="Menos"
                    >
                      {qty === 1 ? <X className="h-4 w-4 text-rose-400" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <span className="w-8 text-center text-base font-semibold tabular-nums">{qty}</span>
                    <button
                      onClick={() => onAdjust(item, 1)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-600"
                      aria-label="Más"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {qty > 0 && (
                  <span className="sr-only">Agregado al pedido</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}