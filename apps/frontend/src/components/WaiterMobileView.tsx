// ──────────────────────────────────────────────
// WaiterMobileView.tsx — Vista del mesero (móvil)
// ──────────────────────────────────────────────
import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { toast } from 'sonner';
import {
  LogOut, ArrowLeft, Send, Loader2, Minus, Plus,
  Users, Clock, ShoppingBag, X, Printer, MessageSquare, CreditCard,
  UtensilsCrossed, Package, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { BrandMark, EASE_OUT, AnimatedMoney } from './ui/motion';
import { initials } from '../lib/admin-helpers';
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
  const { user, logout, can } = useAuth();
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
    <div className="flex min-h-[100dvh] flex-col text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl">
        <div className="flex min-h-[64px] items-center justify-between px-4 py-3">
          <AnimatePresence mode="wait" initial={false}>
            {step === 'tables' ? (
              <motion.div key="brand" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                className="flex items-center gap-3">
                <BrandMark animated className="h-9 w-9" />
                <div>
                  <p className="font-display text-base font-bold leading-tight tracking-tight">Hola, {user?.name.split(' ')[0]}</p>
                  <p className="text-[11px] leading-tight text-muted-foreground">Mesero · elegí una mesa</p>
                </div>
              </motion.div>
            ) : (
              <motion.button key="back" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                onClick={backToTables}
                className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] py-2 pl-2.5 pr-3.5 text-sm font-medium text-foreground/90 active:scale-95"
              >
                <ArrowLeft className="h-4 w-4" />
                Mesas
              </motion.button>
            )}
          </AnimatePresence>

          {step === 'tables' && (
            <button onClick={logout} aria-label="Cerrar sesión"
              className="group flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-1 pr-3 text-xs text-muted-foreground active:scale-95">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-rose-500 font-display text-[10px] font-bold text-white">
                {initials(user?.name ?? '?')}
              </span>
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}

          {selectedTable && step !== 'tables' && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2.5 rounded-2xl border border-brand-400/25 bg-brand-500/10 py-1.5 pl-3 pr-1.5">
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-brand-300/80">
                  {orderType === 'takeaway' ? 'Para llevar' : 'Mesa'}
                </p>
              </div>
              <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 px-2 font-display text-lg font-bold tabular-nums text-white">
                {String(selectedTable.number).padStart(2, '0')}
              </span>
            </motion.div>
          )}
          {!selectedTable && standaloneTakeaway && step !== 'tables' && (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-right">
              <Package className="h-4 w-4 text-amber-300" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Para llevar</p>
                {customerName && <p className="max-w-[120px] truncate text-sm font-semibold leading-tight">{customerName}</p>}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Contenido por paso */}
      <main className="flex-1 overflow-y-auto px-4 py-5">
      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
      >

        {/* STEP: lista de mesas */}
        {step === 'tables' && (
          <>
            {/* Para llevar (sin mesa) */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                setStandaloneTakeaway(true);
                setOrderType('takeaway');
                setSelectedTable(null);
                setCart(new Map());
                setCustomerName('');
                setStep('takeaway-name');
              }}
              className="relative mb-5 flex w-full items-center gap-4 overflow-hidden rounded-3xl border border-amber-300/25 bg-gradient-to-r from-amber-400/15 via-amber-400/[0.06] to-transparent px-5 py-4 text-left"
            >
              <span aria-hidden className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-400/20 blur-2xl" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_8px_24px_-8px_rgb(252_211_77/0.7)]">
                <Package className="h-6 w-6" />
              </span>
              <div className="relative flex-1">
                <p className="font-display text-base font-bold text-amber-100">Para llevar</p>
                <p className="text-xs text-muted-foreground">Sin mesa · se pide el nombre del cliente</p>
              </div>
              <ChevronRight className="relative h-5 w-5 text-amber-300" />
            </motion.button>

            <TablesList tables={tables} loading={loadingTables} onSelect={selectTable} />
            {lastOrderId !== null && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-3">
                <Printer className="h-5 w-5 shrink-0 text-brand-400" />
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
          <div className="flex flex-col gap-4 py-2">
            <div className="mb-2 text-center">
              <p className="font-display text-3xl font-bold tracking-tight">Mesa {selectedTable.number}</p>
              <p className="mt-1 text-sm text-muted-foreground">¿Cómo es el pedido?</p>
            </div>
            <ChoiceCard
              icon={<UtensilsCrossed className="h-7 w-7" />}
              title="Para comer acá"
              subtitle={`Mesa ${selectedTable.number} · ${selectedTable.capacity} lugares`}
              tone="brand"
              onClick={() => confirmOrderType('dine-in')}
            />
            <ChoiceCard
              icon={<Package className="h-7 w-7" />}
              title="Para llevar"
              subtitle="Se pide el nombre del cliente"
              tone="amber"
              onClick={() => confirmOrderType('takeaway')}
            />
          </div>
        )}

        {/* STEP: nombre del cliente (para llevar) */}
        {step === 'takeaway-name' && (
          <div className="flex flex-col gap-5 py-4">
            <div className="text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_12px_32px_-10px_rgb(252_211_77/0.7)]">
                <Package className="h-8 w-8" />
              </span>
              <p className="mt-4 font-display text-2xl font-bold tracking-tight">Para llevar</p>
              <p className="mt-1 text-sm text-muted-foreground">¿A nombre de quién es el pedido?</p>
            </div>
            <input
              autoFocus
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customerName.trim()) setStep('menu'); }}
              placeholder="Nombre del cliente..."
              className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-center text-lg transition-all focus:border-amber-300/60 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
            />
            <Button
              className="h-14 w-full bg-none bg-gradient-to-b from-amber-300 to-amber-500 text-base text-amber-950 shadow-[0_8px_24px_-10px_rgb(252_211_77/0.8)] hover:from-amber-200 hover:to-amber-400"
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
      </motion.div>
      </AnimatePresence>
      </main>

      {/* Sticky footer: enviar pedido + cobrar (si la mesa ya tiene pedidos) */}
      {step === 'menu' && (selectedTable || standaloneTakeaway) && (
        <div className="sticky bottom-0 z-20 space-y-2 border-t border-white/[0.06] bg-background/80 px-4 pt-3 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
          {/* Botón cobrar — mesa ocupada y solo si el rol puede cobrar */}
          {selectedTable && selectedTable.status !== 'AVAILABLE' && can('sales.charge') && (
            <Button
              variant="outline"
              className="h-12 w-full border-brand-500/40 text-brand-400 hover:bg-brand-500/10"
              onClick={() => setCloseModalOpen(true)}
              disabled={submitting}
            >
              <CreditCard className="h-4 w-4" />
              Cobrar y cerrar mesa
            </Button>
          )}
          {/* Botón enviar pedido — solo si hay ítems en el carrito */}
          <AnimatePresence>
            {cartCount > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <Button className="h-16 w-full rounded-2xl px-4 text-base" onClick={sendOrder} disabled={submitting}>
                  <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-white/20 px-2 font-display tabular-nums">
                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : cartCount}
                  </span>
                  <span className="flex flex-1 items-center justify-between pl-1">
                    <span className="flex items-center gap-2">Enviar pedido <Send className="h-4 w-4" /></span>
                    <AnimatedMoney value={cartTotal} className="font-display text-lg" />
                  </span>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Modal de notas por ítem */}
      <Dialog open={notesModal !== null} onOpenChange={(v) => !v && setNotesModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-brand-400" />
              Aclaración: {notesModal?.item.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Escribí los gustos o cambios (sin arroz, término medio, etc.)
            </p>
            <textarea
              autoFocus rows={3}
              className="w-full resize-none rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm transition-all focus:border-brand-400/60 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
              placeholder="Ej: Sin arroz, a punto, extra salsa..."
              value={notesModal?.notes ?? ''}
              onChange={e => setNotesModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
            />
            {notesModal?.notes.trim() && (
              <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.025] px-3 py-2">
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
    <div className="grid grid-cols-3 gap-2.5">
      {Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-3xl" />)}
    </div>
  );
  const enabled = tables.filter(t => t.enabled);
  if (enabled.length === 0) return (
    <p className="py-12 text-center text-sm text-muted-foreground">No hay mesas habilitadas</p>
  );
  return (
    <>
      <p className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Salón</p>
      <div className="grid grid-cols-3 gap-2.5">
        {enabled.map((t, i) => {
          const style = TABLE_STATUS_STYLE[t.status];
          const elapsed = t.openedAt ? elapsedSince(t.openedAt) : null;
          const busy = t.status === 'OCCUPIED' || t.status === 'BILL_REQUESTED';
          return (
            <motion.button key={t.id} onClick={() => onSelect(t)}
              initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: Math.min(i, 18) * 0.025, duration: 0.45, ease: EASE_OUT }}
              whileTap={{ scale: 0.93 }}
              className={cn(
                'relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl border text-center',
                style.border, style.bg, busy && style.glow
              )}>
              {t.status === 'BILL_REQUESTED' && (
                <motion.span aria-hidden className="absolute inset-0 rounded-3xl border-2 border-amber-300"
                  animate={{ opacity: [0.8, 0, 0.8] }} transition={{ duration: 1.6, repeat: Infinity }} />
              )}
              <span className={cn('font-display text-3xl font-bold leading-none tabular-nums', busy ? style.text : 'text-foreground')}>
                {String(t.number).padStart(2, '0')}
              </span>
              <span className={cn('flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em]', style.text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                {TABLE_STATUS_LABEL[t.status]}
              </span>
              {elapsed && (
                <span className="flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />{elapsed}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

function ChoiceCard({ icon, title, subtitle, tone, onClick }: {
  icon: ReactNode; title: string; subtitle: string; tone: 'brand' | 'amber'; onClick: () => void;
}) {
  const t = tone === 'brand'
    ? { box: 'border-brand-400/30 from-brand-500/20', icon: 'from-brand-400 to-brand-600 text-white shadow-glow-sm', title: 'text-brand-100' }
    : { box: 'border-amber-300/30 from-amber-400/20', icon: 'from-amber-300 to-amber-500 text-amber-950', title: 'text-amber-100' };
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn('flex items-center gap-4 rounded-3xl border bg-gradient-to-br to-transparent p-5 text-left', t.box)}
    >
      <span className={cn('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b', t.icon)}>{icon}</span>
      <span className="flex-1">
        <span className={cn('block font-display text-xl font-bold', t.title)}>{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </motion.button>
  );
}

function GuestStep({ table, guestCount, onChange, onConfirm }: {
  table: Table; guestCount: number; onChange: (n: number) => void; onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="text-center">
        <p className="font-display text-3xl font-bold tracking-tight">Mesa {table.number}</p>
        <p className="mt-1 text-sm text-muted-foreground">¿Cuántos comensales?</p>
      </div>
      <div className="flex items-center gap-8">
        <motion.button whileTap={{ scale: 0.88 }} onClick={() => onChange(Math.max(1, guestCount - 1))}
          aria-label="Menos comensales"
          className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
          <Minus className="h-6 w-6" />
        </motion.button>
        <div className="flex w-24 flex-col items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={guestCount}
              initial={{ y: 20, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="font-display text-7xl font-bold tabular-nums text-gradient"
            >
              {guestCount}
            </motion.span>
          </AnimatePresence>
          <span className="text-xs text-muted-foreground">de {table.capacity} lugares</span>
        </div>
        <motion.button whileTap={{ scale: 0.88 }} onClick={() => onChange(Math.min(table.capacity, guestCount + 1))}
          aria-label="Más comensales"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-glow-sm">
          <Plus className="h-6 w-6" />
        </motion.button>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: table.capacity }).map((_, i) => (
          <motion.span key={i} animate={{ scale: i < guestCount ? 1 : 0.7, opacity: i < guestCount ? 1 : 0.3 }}
            className={cn('h-2.5 w-2.5 rounded-full', i < guestCount ? 'bg-brand-400' : 'bg-white/30')} />
        ))}
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
    <div className="space-y-2.5">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
    </div>
  );
  return (
    <div>
      {/* Badge para llevar */}
      {orderType === 'takeaway' && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-200">
          <Package className="h-3.5 w-3.5" />
          <span>Para llevar — <strong>{customerName}</strong></span>
        </div>
      )}

      {previousItemsCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-300">
          <ShoppingBag className="h-3.5 w-3.5" />
          Esta mesa ya tiene {previousItemsCount} ítems pedidos. Lo que sumés será un pedido nuevo.
        </div>
      )}

      {/* Tabs de categorías */}
      <div className="sticky top-[64px] z-10 -mx-4 mb-4 overflow-x-auto bg-background/80 px-4 py-2 backdrop-blur-xl">
        <LayoutGroup id="waiter-categories">
          <div className="flex gap-1.5 whitespace-nowrap">
            {categories.map(cat => {
              const active = activeCategory === cat;
              return (
                <button key={cat} onClick={() => onCategoryChange(cat)}
                  className={cn(
                    'relative rounded-full px-4 py-2 text-xs font-semibold transition-colors',
                    active ? 'text-white' : 'bg-white/[0.04] text-muted-foreground'
                  )}>
                  {active && (
                    <motion.span layoutId="waiter-cat-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 shadow-glow-sm" />
                  )}
                  <span className="relative">{cat}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      {/* Lista de ítems */}
      <div className="space-y-2.5 pb-28">
        {menu.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay items en {activeCategory}</p>
        ) : (
          menu.map((item, idx) => {
            const inCart = cart.get(item.id);
            const qty = inCart?.quantity ?? 0;
            const hasNotes = !!inCart?.notes?.trim();
            return (
              <motion.div key={item.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx, 12) * 0.03, duration: 0.4, ease: EASE_OUT }}
                className={cn(
                  'relative overflow-hidden rounded-2xl border transition-colors duration-300',
                  qty > 0 ? 'border-brand-400/40 bg-gradient-to-r from-brand-500/15 to-brand-500/[0.03]' : 'border-white/[0.07] bg-white/[0.025]'
                )}>
                {qty > 0 && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-300 to-brand-600" />}
                <div className="flex items-center gap-3 p-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[15px] font-semibold">{item.name}</p>
                    {item.description && <p className="truncate text-xs text-muted-foreground">{item.description}</p>}
                    <p className="mt-1 font-display text-base font-bold tabular-nums text-brand-300">
                      {formatMoney(item.price)}
                    </p>
                    {item.stock === 'LOW_STOCK' && (
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> Stock bajo
                      </p>
                    )}
                  </div>

                  {qty > 0 && (
                    <button onClick={() => onAddNote(item)}
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                        hasNotes
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                          : 'border-border bg-white/[0.04] text-muted-foreground hover:text-foreground'
                      )}
                      title={hasNotes ? 'Editar aclaración' : 'Agregar aclaración'}>
                      <MessageSquare className="h-4 w-4" />
                    </button>
                  )}

                  {qty === 0 ? (
                    <motion.button whileTap={{ scale: 0.85 }} onClick={() => onAdjust(item, 1)} aria-label={`Agregar ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-glow-sm">
                      <Plus className="h-5 w-5" />
                    </motion.button>
                  ) : (
                    <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-black/25 p-1">
                      <motion.button whileTap={{ scale: 0.85 }} onClick={() => onAdjust(item, -1)} aria-label="Quitar uno"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06]">
                        {qty === 1 ? <X className="h-4 w-4 text-rose-400" /> : <Minus className="h-4 w-4" />}
                      </motion.button>
                      <span className="relative flex h-9 w-8 items-center justify-center overflow-hidden">
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span key={qty}
                            initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 600, damping: 32 }}
                            className="font-display text-base font-bold tabular-nums">
                            {qty}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                      <motion.button whileTap={{ scale: 0.85 }} onClick={() => onAdjust(item, 1)} aria-label="Sumar uno"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
                        <Plus className="h-4 w-4" />
                      </motion.button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {hasNotes && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-amber-300/15">
                      <div className="px-4 pb-2.5 pt-2">
                        {inCart!.notes.trim().split('\n').map((line, i) => (
                          <p key={i} className="text-xs text-amber-200/85">• {line}</p>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
