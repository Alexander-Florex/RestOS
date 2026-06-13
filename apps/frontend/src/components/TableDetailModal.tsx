// ──────────────────────────────────────────────
// TableDetailModal.tsx — Detalle de mesa con pedidos + acciones
// ──────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Users, Clock, Loader2, Receipt, Lock, CalendarCheck,
  XCircle, DoorOpen, Minus, Plus, ShoppingBag, CreditCard, Printer,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { tablesApi, ApiError, type Table, printingApi } from '../lib/api';
import {
  TABLE_STATUS_LABEL, TABLE_STATUS_STYLE, elapsedSince,
} from '../lib/table-helpers';
import { useTick } from '../hooks/useTables';
import { useTableOrders } from '../hooks/useTableOrders';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../lib/format';
import { CloseTableModal } from './CloseTableModal';
import { PrintButton, printerPrefs } from './PrintButton';
import { cn } from '../lib/utils';

interface TableDetailModalProps {
  table: Table | null;
  open: boolean;
  onClose: () => void;
}

export function TableDetailModal({ table, open, onClose }: TableDetailModalProps) {
  const { user } = useAuth();
  const isAdminOrStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const [openingMode, setOpeningMode] = useState(false);
  const [guestCount, setGuestCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);

  // Solo cargamos pedidos si la mesa está ocupada o con cuenta pedida
  const tableId = table && (table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED')
    ? table.id
    : null;
  const { orders, total, loading: loadingOrders } = useTableOrders(tableId);

  useTick(30_000);

  useEffect(() => {
    if (!open) {
      setOpeningMode(false);
      setSubmitting(false);
      setCloseModalOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (table) setGuestCount(1); // Inicia en 1 para no asumir comensales
  }, [table]);

  if (!table) return null;

  const style = TABLE_STATUS_STYLE[table.status];
  const elapsed = elapsedSince(table.openedAt);

  async function runAction(fn: () => Promise<unknown>, successMsg: string) {
    setSubmitting(true);
    try {
      await fn();
      toast.success(successMsg);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error en la acción');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Modal: Elegir comensales para abrir ──
  if (openingMode && table) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir mesa N° {table.number}</DialogTitle>
            <DialogDescription>¿Cuántos comensales son?</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center gap-4 py-6">
            <Button
              variant="outline" size="icon"
              disabled={guestCount <= 1 || submitting}
              onClick={() => setGuestCount(g => Math.max(1, g - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5">
              <span className="text-4xl font-bold text-emerald-400 tabular-nums">{guestCount}</span>
            </div>
            <Button
              variant="outline" size="icon"
              disabled={guestCount >= table.capacity || submitting}
              onClick={() => setGuestCount(g => Math.min(table.capacity, g + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Capacidad: {table.capacity} personas
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningMode(false)} disabled={submitting}>
              Volver
            </Button>
            <Button
              onClick={() => runAction(
                () => tablesApi.open(table.id, guestCount),
                `Mesa ${table.number} abierta con ${guestCount} comensales`
              )}
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const hasOrders = orders.length > 0;
  const showOrdersSection = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';

  return (
    <>
      <Dialog open={open && !closeModalOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl border-2 font-bold tabular-nums',
                style.border, style.bg, style.text
              )}>
                {table.number}
              </div>
              <div>
                <DialogTitle>Mesa N° {table.number}</DialogTitle>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                  <DialogDescription className={style.text}>
                    {TABLE_STATUS_LABEL[table.status]}
                  </DialogDescription>
                </div>
              </div>
            </div>
          </DialogHeader>

          {/* Info de la mesa */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3 w-3" /> Comensales
              </div>
              <p className="mt-1 text-lg font-semibold">
                {table.guestCount !== null ? `${table.guestCount} / ${table.capacity}` : `— / ${table.capacity}`}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> Tiempo
              </div>
              <p className="mt-1 text-lg font-semibold">{elapsed ?? '—'}</p>
            </div>
          </div>

          {/* Pedidos de la mesa */}
          {showOrdersSection && (
            <div className="mt-4 rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold">Pedidos de la mesa</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}
                </p>
              </div>

              {loadingOrders ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Cargando pedidos...
                </div>
              ) : !hasOrders ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  Sin pedidos todavía
                </p>
              ) : (
                <>
                  {/* Cada pedido individualmente con su botón de imprimir */}
                  <div className="max-h-72 space-y-3 overflow-y-auto">
                    {orders.map((order, idx) => {
                      const isLatest = idx === orders.length - 1;
                      const orderSubtotal = order.items.reduce(
                        (s, i) => s + Number(i.price) * i.quantity, 0
                      );
                      const isTakeaway = order.notes?.startsWith('PARA LLEVAR:');
                      const takeawayName = isTakeaway
                        ? order.notes!.replace('PARA LLEVAR:', '').trim()
                        : null;
                      return (
                        <div key={order.id} className={cn(
                          'rounded-lg border p-3',
                          isLatest ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'
                        )}>
                          {/* Header del pedido */}
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Pedido #{order.id}
                              </span>
                              {isLatest && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                                  Último
                                </span>
                              )}
                              {isTakeaway && (
                                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
                                  🥡 {takeawayName}
                                </span>
                              )}
                            </div>
                            {/* Botón imprimir — solo ADMIN/STAFF */}
                            {isAdminOrStaff && (
                              <button
                                onClick={() => {
                                  const printerName = printerPrefs.getPrinter();
                                  if (!printerName) {
                                    toast.error('Configurá la impresora primero desde el sidebar');
                                    return;
                                  }
                                  printingApi.printOrder(order.id, {
                                    printerName,
                                    restaurantName: printerPrefs.getRestaurant(),
                                  })
                                    .then(() => toast.success(`Pedido #${order.id} enviado a cocina`))
                                    .catch(err => toast.error(err?.message ?? 'Error al imprimir'));
                                }}
                                className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
                                title={`Reimprimir pedido #${order.id} en cocina`}
                              >
                                <Printer className="h-3 w-3" />
                                Reimprimir
                              </button>
                            )}
                          </div>

                          {/* Items del pedido */}
                          <div className="space-y-1">
                            {order.items.map(item => (
                              <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                                <div className="flex-1 min-w-0">
                                  <span>{item.itemName}</span>
                                  {item.notes && (
                                    <p className="text-xs italic text-muted-foreground">• {item.notes}</p>
                                  )}
                                </div>
                                <span className="shrink-0 tabular-nums text-muted-foreground">x{item.quantity}</span>
                                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                                  {formatMoney(Number(item.price) * item.quantity)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Subtotal si hay múltiples pedidos */}
                          {orders.length > 1 && (
                            <div className="mt-2 flex justify-end border-t border-border pt-1.5">
                              <span className="text-xs text-muted-foreground tabular-nums">
                                Subtotal: {formatMoney(orderSubtotal)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Total global */}
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span className="text-sm font-semibold">Total</span>
                    <span className="text-lg font-bold text-emerald-400 tabular-nums">
                      {formatMoney(total)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Acciones para ADMIN y STAFF */}
          {isAdminOrStaff && (
            <div className="mt-5 space-y-2">
              {table.status === 'AVAILABLE' && (
                <>
                  <Button className="w-full" onClick={() => setOpeningMode(true)} disabled={submitting}>
                    <DoorOpen className="h-4 w-4" />
                    Abrir mesa
                  </Button>
                  <Button
                    variant="outline" className="w-full"
                    disabled={submitting}
                    onClick={() => runAction(
                      () => tablesApi.reserve(table.id),
                      `Mesa ${table.number} reservada`
                    )}
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Marcar como reservada
                  </Button>
                </>
              )}

              {table.status === 'OCCUPIED' && (
                <>
                  <Button
                    variant="outline" className="w-full"
                    disabled={submitting}
                    onClick={() => runAction(
                      () => tablesApi.requestBill(table.id),
                      `Cuenta pedida en mesa ${table.number}`
                    )}
                  >
                    <Receipt className="h-4 w-4" />
                    Pedir cuenta
                  </Button>
                  {hasOrders ? (
                    <>
                      <Button className="w-full" onClick={() => setCloseModalOpen(true)} disabled={submitting}>
                        <CreditCard className="h-4 w-4" />
                        Cobrar y cerrar mesa
                      </Button>
                      <PrintButton
                        label="Imprimir pedido"
                        variant="outline"
                        className="w-full"
                        onPrint={(printerName, restaurantName) => {
                          const lastOrder = orders[orders.length - 1];
                          if (!lastOrder) return Promise.reject(new Error('No hay pedidos'));
                          return printingApi.printOrder(lastOrder.id, { printerName, restaurantName }).then(() => {});
                        }}
                      />
                    </>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={submitting}
                      onClick={() => runAction(
                        () => tablesApi.close(table.id),
                        `Mesa ${table.number} liberada`
                      )}
                    >
                      <Lock className="h-4 w-4" />
                      Liberar mesa (sin venta)
                    </Button>
                  )}
                </>
              )}

              {table.status === 'BILL_REQUESTED' && (
                <>
                  {hasOrders ? (
                    <>
                      <Button className="w-full" onClick={() => setCloseModalOpen(true)} disabled={submitting}>
                        <CreditCard className="h-4 w-4" />
                        Cobrar y cerrar mesa
                      </Button>
                      <PrintButton
                        label="Imprimir pedido"
                        variant="outline"
                        className="w-full"
                        onPrint={(printerName, restaurantName) => {
                          const lastOrder = orders[orders.length - 1];
                          if (!lastOrder) return Promise.reject(new Error('No hay pedidos'));
                          return printingApi.printOrder(lastOrder.id, { printerName, restaurantName }).then(() => {});
                        }}
                      />
                    </>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={submitting}
                      onClick={() => runAction(
                        () => tablesApi.close(table.id),
                        `Mesa ${table.number} liberada`
                      )}
                    >
                      <Lock className="h-4 w-4" />
                      Liberar mesa (sin venta)
                    </Button>
                  )}
                </>
              )}

              {table.status === 'RESERVED' && (
                <>
                  <Button className="w-full" onClick={() => setOpeningMode(true)} disabled={submitting}>
                    <DoorOpen className="h-4 w-4" />
                    Abrir mesa (los reservantes llegaron)
                  </Button>
                  <Button
                    variant="outline" className="w-full"
                    disabled={submitting}
                    onClick={() => runAction(
                      () => tablesApi.cancelReservation(table.id),
                      `Reserva de mesa ${table.number} cancelada`
                    )}
                  >
                    <XCircle className="h-4 w-4" />
                    Cancelar reserva
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Acciones para WAITER — puede pedir cuenta y cobrar (sin imprimir) */}
          {!isAdminOrStaff && user?.role === 'WAITER' && (
            <div className="mt-5 space-y-2">
              {(table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED') && hasOrders && (
                <>
                  {table.status === 'OCCUPIED' && (
                    <Button
                      variant="outline" className="w-full"
                      disabled={submitting}
                      onClick={() => runAction(
                        () => tablesApi.requestBill(table.id),
                        `Cuenta pedida en mesa ${table.number}`
                      )}
                    >
                      <Receipt className="h-4 w-4" />
                      Pedir cuenta
                    </Button>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => setCloseModalOpen(true)}
                    disabled={submitting}
                  >
                    <CreditCard className="h-4 w-4" />
                    Cobrar y cerrar mesa
                  </Button>
                </>
              )}
              {!hasOrders && (table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED') && (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                  La mesa no tiene pedidos registrados
                </p>
              )}
              {table.status === 'AVAILABLE' && (
                <p className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-center text-xs text-muted-foreground">
                  Mesa libre — usá la vista de mesero para tomar pedidos
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-modal de cierre con venta */}
      <CloseTableModal
        table={table}
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        onSuccess={() => { setCloseModalOpen(false); onClose(); }}
        orders={orders}
        total={total}
      />
    </>
  );
}
