// ──────────────────────────────────────────────
// WaiterMobileView.tsx — Vista del mesero (móvil)
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChefHat, LogOut, ArrowLeft, Send, Loader2, Minus, Plus,
  Users, Clock, ShoppingBag, X, Printer, MessageSquare, CreditCard,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTables, useTick } from '../hooks/useTables';
import { useMenu } from '../hooks/useMenu';
import { useTableOrders } from '../hooks/useTableOrders';
import { ordersApi, printingApi, salesApi, takeawayApi, type MenuItem, type Table, ApiError } from '../lib/api';
import { TABLE_STATUS_LABEL, TABLE_STATUS_STYLE, elapsedSince } from '../lib/table-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { PrintButton, printerPrefs } from './PrintButton';
import { CloseTableModal } from './CloseTableModal';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

type Step = 'tables' | 'type' | 'takeaway-name' | 'guests' | 'menu';
type OrderType = 'dine-in' | 'takeaway';

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  notes: string;
}

export function WaiterMobileView() {
  const { user, logout } = useAuth();
  const { tables, loading: loadingTables } = useTables();
  const { items: menu, loading: loadingMenu } = useMenu({ onlyEnabled: true });

  const [step, setStep] = useState<Step>('tables');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('dine-in');
  const [customerName, setCustomerName] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [cart, setCart] = useState<Map<number, CartItem>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [lastOrderId, setLastOrderId] = useState<number | null>(null);
  const [notesModal, setNotesModal] = useState<{ item: MenuItem; notes: string } | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  // Flujo para llevar SIN mesa — true cuando el mesero toca "Para llevar" en la lista
  const [standaloneTakeaway, setStandaloneTakeaway] = useState(false);

  useTick(30_000);

  const { orders: previousOrders } = useTableOrders(
    selectedTable && selectedTable.status !== 'AVAILABLE' ? selectedTable.id : null
  );

  // Categorías dinámicas de los ítems del menú
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of menu) {
      if (item.category && !seen.has(item.category)) {
        seen.add(item.category);
        result.push(item.category);
      }
    }
    return result.sort();
  }, [menu]);

  const effectiveCategory = useMemo(() => {
    if (!activeCategory || !categories.includes(activeCategory)) {
      return categories[0] ?? '';
    }
    return activeCategory;
  }, [activeCategory, categories]);

  const filteredMenu = useMemo(
    () => menu.filter(m => m.category === effectiveCategory && m.stock !== 'OUT_OF_STOCK'),
    [menu, effectiveCategory]
  );

  const cartTotal = useMemo(() => {
    let t = 0;
    for (const ci of cart.values()) t += Number(ci.menuItem.price) * ci.quantity;
    return t;
  }, [cart]);

  const cartCount = useMemo(() => {
    let c = 0;
    for (const ci of cart.values()) c += ci.quantity;
    return c;
  }, [cart]);

  function selectTable(t: Table) {
    if (t.status === 'RESERVED') {
      toast.error('Mesa reservada. Avisá al admin.');
      return;
    }
    if (!t.enabled) {
      toast.error('Mesa deshabilitada.');
      return;
    }
    setSelectedTable(t);
    setCart(new Map());
    setOrderType('dine-in');
    setCustomerName('');
    setStep('type');
  }

  function confirmOrderType(type: OrderType) {
    setOrderType(type);
    if (type === 'takeaway') {
      setStep('takeaway-name');
    } else {
      if (selectedTable!.status === 'AVAILABLE') {
        setGuestCount(1);
        setStep('guests');
      } else {
        setStep('menu');
      }
    }
  }

  function backToTables() {
    setStep('tables');
    setSelectedTable(null);
    setCart(new Map());
    setCustomerName('');
    setOrderType('dine-in');
    setStandaloneTakeaway(false);
  }

  function adjustQty(item: MenuItem, delta: number) {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(item.id);
      const newQty = (current?.quantity ?? 0) + delta;
      if (newQty <= 0) next.delete(item.id);
      else next.set(item.id, { menuItem: item, quantity: newQty, notes: current?.notes ?? '' });
      return next;
    });
  }

  function saveNotes(item: MenuItem, notes: string) {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(item.id);
      if (current) next.set(item.id, { ...current, notes });
      return next;
    });
    setNotesModal(null);
  }

  async function sendOrder() {
    if (cart.size === 0) return;
    setSubmitting(true);
    try {
      if (standaloneTakeaway) {
        // Pedido para llevar SIN mesa — va a TakeawayOrder
        const { order } = await takeawayApi.create({
          customerName: customerName.trim(),
          items: Array.from(cart.values()).map(ci => ({
            menuItemId: ci.menuItem.id,
            quantity:   ci.quantity,
            notes:      ci.notes || undefined,
          })),
        });
        setLastOrderId(order.id);
        toast.success(`Pedido para llevar creado — ${customerName}`, { duration: 4000 });
        backToTables();
        return;
      }

      if (!selectedTable) return;

      // Pedido normal (con mesa, puede ser dine-in o para llevar)
      const { order } = await ordersApi.create({
        tableId: selectedTable.id,
        guestCount: orderType === 'dine-in' && selectedTable.status === 'AVAILABLE' ? guestCount : undefined,
        notes: orderType === 'takeaway' ? `PARA LLEVAR: ${customerName.trim()}` : undefined,
        items: Array.from(cart.values()).map(ci => ({
          menuItemId: ci.menuItem.id,
          quantity:   ci.quantity,
          notes:      ci.notes || undefined,
        })),
      });
      setLastOrderId(order.id);
      toast.success(
        orderType === 'takeaway'
          ? `Pedido para llevar (${customerName}) enviado`
          : `Pedido enviado a mesa ${selectedTable.number}`,
        {
          description: printerPrefs.getPrinter() ? 'Podés imprimir la comanda abajo' : undefined,
          duration: 4000,
        }
      );
      backToTables();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al enviar el pedido');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          {step === 'tables' ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
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
              {orderType === 'takeaway' && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400">
                  Para llevar
                </p>
              )}
            </div>
          )}
          {!selectedTable && standaloneTakeaway && step !== 'tables' && (
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400">🥡 Para llevar</p>
              {customerName && <p className="text-sm font-semibold leading-tight truncate max-w-[120px]">{customerName}</p>}
            </div>
          )}
        </div>
      </header>

      {/* Contenido por paso */}
      <main className="flex-1 overflow-y-auto px-4 py-4">

        {/* STEP: lista de mesas */}
        {step === 'tables' && (
          <>
            {/* Botón flotante Para llevar (sin mesa) */}
            <button
              onClick={() => {
                setStandaloneTakeaway(true);
                setOrderType('takeaway');
                setSelectedTable(null);
                setCart(new Map());
                setCustomerName('');
                setStep('takeaway-name');
              }}
              className="mb-4 flex w-full items-center gap-3 rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 px-5 py-4 text-left transition-colors hover:bg-amber-500/10 active:scale-95"
            >
              <span className="text-3xl">🥡</span>
              <div>
                <p className="text-base font-semibold text-amber-400">Para llevar</p>
                <p className="text-xs text-muted-foreground">Sin mesa asignada · pide nombre del cliente</p>
              </div>
            </button>

            <TablesList tables={tables} loading={loadingTables} onSelect={selectTable} />
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
                <button onClick={() => setLastOrderId(null)} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}

        {/* STEP: elegir tipo (comer acá / para llevar) */}
        {step === 'type' && selectedTable && (
          <div className="flex flex-col gap-4 py-4">
            <div className="text-center">
              <p className="text-lg font-semibold">Mesa N° {selectedTable.number}</p>
              <p className="mt-1 text-sm text-muted-foreground">¿Cómo es el pedido?</p>
            </div>
            <button
              onClick={() => confirmOrderType('dine-in')}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-8 text-center transition-colors hover:bg-emerald-500/10 active:scale-95"
            >
              <span className="text-5xl">🍽️</span>
              <div>
                <p className="text-base font-semibold text-emerald-400">Para comer acá</p>
                <p className="text-xs text-muted-foreground mt-0.5">Mesa {selectedTable.number} · {selectedTable.capacity} pax</p>
              </div>
            </button>
            <button
              onClick={() => confirmOrderType('takeaway')}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 p-8 text-center transition-colors hover:bg-amber-500/10 active:scale-95"
            >
              <span className="text-5xl">🥡</span>
              <div>
                <p className="text-base font-semibold text-amber-400">Para llevar</p>
                <p className="text-xs text-muted-foreground mt-0.5">Se pide el nombre del cliente</p>
              </div>
            </button>
          </div>
        )}

        {/* STEP: nombre del cliente (para llevar) */}
        {step === 'takeaway-name' && (
          <div className="flex flex-col gap-5 py-4">
            <div className="text-center">
              <span className="text-5xl">🥡</span>
              <p className="mt-3 text-lg font-semibold">Para llevar</p>
              <p className="mt-1 text-sm text-muted-foreground">¿A nombre de quién es el pedido?</p>
            </div>
            <input
              autoFocus
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customerName.trim()) setStep('menu'); }}
              placeholder="Nombre del cliente..."
              className="w-full rounded-2xl border border-input bg-background px-4 py-4 text-center text-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <Button
              className="h-14 w-full bg-amber-500 text-base hover:bg-amber-600"
              onClick={() => {
                if (!customerName.trim()) { toast.error('Ingresá el nombre del cliente'); return; }
                setStep('menu');
              }}
            >
              Continuar al menú →
            </Button>
          </div>
        )}

        {/* STEP: cantidad de comensales */}
        {step === 'guests' && selectedTable && (
          <GuestStep
            table={selectedTable}
            guestCount={guestCount}
            onChange={setGuestCount}
            onConfirm={() => setStep('menu')}
          />
        )}

        {/* STEP: menú */}
        {step === 'menu' && (selectedTable || standaloneTakeaway) && (
          <MenuStep
            menu={filteredMenu}
            categories={categories}
            activeCategory={effectiveCategory}
            onCategoryChange={setActiveCategory}
            cart={cart}
            onAdjust={adjustQty}
            onAddNote={(item) => setNotesModal({ item, notes: cart.get(item.id)?.notes ?? '' })}
            loading={loadingMenu}
            previousItemsCount={previousOrders.flatMap(o => o.items).length}
            orderType={orderType}
            customerName={customerName}
          />
        )}
      </main>

      {/* Sticky footer: enviar pedido + cobrar (si la mesa ya tiene pedidos) */}
      {step === 'menu' && (selectedTable || standaloneTakeaway) && (
        <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur space-y-2">
          {/* Botón cobrar — visible cuando la mesa ya está ocupada (tiene pedidos anteriores) */}
          {selectedTable && selectedTable.status !== 'AVAILABLE' && (
            <Button
              variant="outline"
              className="h-12 w-full border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => setCloseModalOpen(true)}
              disabled={submitting}
            >
              <CreditCard className="h-4 w-4" />
              Cobrar y cerrar mesa
            </Button>
          )}
          {/* Botón enviar pedido — solo si hay ítems en el carrito */}
          {cartCount > 0 && (
            <Button className="h-14 w-full text-base" onClick={sendOrder} disabled={submitting}>
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              <div className="flex flex-1 items-center justify-between">
                <span>Enviar pedido ({cartCount} {cartCount === 1 ? 'ítem' : 'ítems'})</span>
                <span className="tabular-nums">{formatMoney(cartTotal)}</span>
              </div>
            </Button>
          )}
        </div>
      )}

      {/* Modal de notas por ítem */}
      <Dialog open={notesModal !== null} onOpenChange={(v) => !v && setNotesModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-emerald-400" />
              Aclaración: {notesModal?.item.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Escribí los gustos o cambios (sin arroz, término medio, etc.)
            </p>
            <textarea
              autoFocus rows={3}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              placeholder="Ej: Sin arroz, a punto, extra salsa..."
              value={notesModal?.notes ?? ''}
              onChange={e => setNotesModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
            />
            {notesModal?.notes.trim() && (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Vista previa del ticket:</p>
                <p className="text-sm font-medium">1x {notesModal.item.name}</p>
                {notesModal.notes.trim().split('\n').map((line, i) => (
                  <p key={i} className="text-xs text-muted-foreground pl-3">• {line}</p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesModal(null)}>Cancelar</Button>
            <Button onClick={() => notesModal && saveNotes(notesModal.item, notesModal.notes)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal cobrar y cerrar (mesero — sin impresión) */}
      {selectedTable && (
        <CloseTableModal
          table={selectedTable}
          open={closeModalOpen}
          onClose={() => setCloseModalOpen(false)}
          onSuccess={() => { setCloseModalOpen(false); backToTables(); }}
          orders={previousOrders}
          total={previousOrders.flatMap(o => o.items).reduce(
            (s, i) => s + Number(i.price) * i.quantity, 0
          )}
        />
      )}
    </div>
  );
}

// ── Sub-componentes ──

function TablesList({ tables, loading, onSelect }: {
  tables: Table[]; loading: boolean; onSelect: (t: Table) => void;
}) {
  useTick(10_000);
  if (loading) return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
  const enabled = tables.filter(t => t.enabled);
  if (enabled.length === 0) return (
    <p className="py-12 text-center text-sm text-muted-foreground">No hay mesas habilitadas</p>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {enabled.map(t => {
        const style = TABLE_STATUS_STYLE[t.status];
        const elapsed = t.openedAt ? elapsedSince(t.openedAt) : null;
        return (
          <button key={t.id} onClick={() => onSelect(t)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-2xl border-2 p-4 text-center transition-all active:scale-95',
              style.border, style.bg
            )}>
            <span className={cn('text-2xl font-bold tabular-nums', style.text)}>
              {String(t.number).padStart(2, '0')}
            </span>
            <span className={cn('text-[10px] font-medium uppercase tracking-wider', style.text)}>
              {TABLE_STATUS_LABEL[t.status]}
            </span>
            {elapsed && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />{elapsed}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function GuestStep({ table, guestCount, onChange, onConfirm }: {
  table: Table; guestCount: number; onChange: (n: number) => void; onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="text-center">
        <p className="text-lg font-semibold">Mesa N° {table.number}</p>
        <p className="mt-1 text-sm text-muted-foreground">¿Cuántos comensales?</p>
      </div>
      <div className="flex items-center gap-6">
        <button onClick={() => onChange(Math.max(1, guestCount - 1))}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-border bg-secondary text-xl font-bold hover:bg-secondary/80">
          −
        </button>
        <div className="flex flex-col items-center">
          <span className="text-5xl font-bold tabular-nums text-emerald-400">{guestCount}</span>
          <span className="text-xs text-muted-foreground">de {table.capacity} pax</span>
        </div>
        <button onClick={() => onChange(Math.min(table.capacity, guestCount + 1))}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-xl font-bold text-white hover:bg-emerald-600">
          +
        </button>
      </div>
      <Button className="h-14 w-full text-base" onClick={onConfirm}>
        Confirmar · {guestCount} {guestCount === 1 ? 'comensal' : 'comensales'}
      </Button>
    </div>
  );
}

function MenuStep({
  menu, categories, activeCategory, onCategoryChange,
  cart, onAdjust, onAddNote, loading, previousItemsCount, orderType, customerName,
}: {
  menu: MenuItem[];
  categories: string[];
  activeCategory: string;
  onCategoryChange: (c: string) => void;
  cart: Map<number, CartItem>;
  onAdjust: (item: MenuItem, delta: number) => void;
  onAddNote: (item: MenuItem) => void;
  loading: boolean;
  previousItemsCount: number;
  orderType: OrderType;
  customerName: string;
}) {
  if (loading) return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
  return (
    <div>
      {/* Badge para llevar */}
      {orderType === 'takeaway' && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <span>🥡</span>
          <span>Para llevar — <strong>{customerName}</strong></span>
        </div>
      )}

      {previousItemsCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-300">
          <ShoppingBag className="h-3.5 w-3.5" />
          Esta mesa ya tiene {previousItemsCount} ítems pedidos. Lo que sumés será un pedido nuevo.
        </div>
      )}

      {/* Tabs de categorías */}
      <div className="-mx-4 mb-3 overflow-x-auto px-4">
        <div className="flex gap-2 whitespace-nowrap pb-1">
          {categories.map(cat => (
            <button key={cat} onClick={() => onCategoryChange(cat)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                activeCategory === cat
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-secondary/30 text-muted-foreground'
              )}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de ítems */}
      <div className="space-y-2 pb-24">
        {menu.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay items en {activeCategory}</p>
        ) : (
          menu.map(item => {
            const inCart = cart.get(item.id);
            const qty = inCart?.quantity ?? 0;
            const hasNotes = !!inCart?.notes?.trim();
            return (
              <div key={item.id} className={cn(
                'rounded-xl border transition-colors',
                qty > 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'
              )}>
                <div className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.description ?? '—'}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-400">
                      {formatMoney(item.price)}
                    </p>
                    {item.stock === 'LOW_STOCK' && (
                      <p className="text-[10px] uppercase tracking-wider text-amber-400 mt-0.5">⚠ Stock bajo</p>
                    )}
                  </div>

                  {qty > 0 && (
                    <button onClick={() => onAddNote(item)}
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                        hasNotes
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
                      )}
                      title={hasNotes ? 'Editar aclaración' : 'Agregar aclaración'}>
                      <MessageSquare className="h-4 w-4" />
                    </button>
                  )}

                  {qty === 0 ? (
                    <button onClick={() => onAdjust(item, 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600">
                      <Plus className="h-5 w-5" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => onAdjust(item, -1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary hover:bg-secondary/80">
                        {qty === 1 ? <X className="h-4 w-4 text-rose-400" /> : <Minus className="h-4 w-4" />}
                      </button>
                      <span className="w-8 text-center text-base font-semibold tabular-nums">{qty}</span>
                      <button onClick={() => onAdjust(item, 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {hasNotes && (
                  <div className="border-t border-amber-500/20 px-3 pb-2 pt-1.5">
                    {inCart!.notes.trim().split('\n').map((line, i) => (
                      <p key={i} className="text-xs text-amber-300/80">• {line}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
