// ──────────────────────────────────────────────
// menu.service.ts — Lógica de items del menú
// Cada plato viaja con sus grupos de opciones (personalización, tarea 5.7).
// ──────────────────────────────────────────────
import { MenuOptionGroupType, Prisma, StockStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { stockAutoService } from '../stock/stock-auto.service.js';
import { HttpError } from '../../lib/http-error.js';
import { optionGroupsInclude, type MenuItemWithOptions } from '../../lib/modifiers.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit } from '../../lib/audit.js';
import { toCents } from '../../lib/money.js';

/** Resumen de las opciones de un plato para la auditoría. */
function optionsSummary(groups: MenuItemWithOptions['optionGroups']) {
  return groups.map(g => ({
    name: g.name, type: g.type, required: g.required,
    options: g.options.map(o => ({ name: o.name, priceDelta: o.priceDelta, isDefault: o.isDefault })),
  }));
}

function emitChanged(restaurantId: number, item: MenuItemWithOptions) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_CHANGED, item);
}
function emitCreated(restaurantId: number, item: MenuItemWithOptions) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_CREATED, item);
}
function emitDeleted(restaurantId: number, id: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_DELETED, { id });
}

export interface CreateMenuItemData {
  name: string;
  category: string;
  price: number;
  description?: string;
  stock?: StockStatus;
  /** El estado sale del stock de los insumos de su receta (tarea 3.8) */
  stockAuto?: boolean;
  enabled?: boolean;
  imageUrl?: string;
}

export interface UpdateMenuItemData extends Partial<CreateMenuItemData> {
  /** Plato que es la versión grande de este; null = sin versión grande */
  largeVersionId?: number | null;
}

/** Un plato tiene una sola versión grande, y una versión grande no tiene otra encima. */
async function assertLargeVersion(tx: Prisma.TransactionClient, restaurantId: number, id: number, largeId: number) {
  if (largeId === id) throw HttpError.badRequest('Un plato no puede ser su propia versión grande');
  const large = await tx.menuItem.findFirst({ where: { id: largeId, restaurantId }, select: { largeVersionId: true } });
  if (!large) throw HttpError.badRequest('La versión grande elegida no existe');
  if (large.largeVersionId !== null) throw HttpError.badRequest('Ese plato ya tiene su propia versión grande');
  const baseOfThis = await tx.menuItem.findFirst({ where: { restaurantId, largeVersionId: id }, select: { name: true } });
  if (baseOfThis) throw HttpError.badRequest(`Este plato ya es la versión grande de "${baseOfThis.name}"`);
  const taken = await tx.menuItem.findFirst({ where: { restaurantId, largeVersionId: largeId, id: { not: id } }, select: { name: true } });
  if (taken) throw HttpError.conflict(`Ese plato ya es la versión grande de "${taken.name}"`);
}

/** Configuración de opciones de un plato tal como la edita el Administrador. */
export interface OptionGroupInput {
  id?: number;
  name: string;
  type: MenuOptionGroupType;
  required: boolean;
  options: Array<{ id?: number; name: string; priceDelta: number; isDefault: boolean }>;
}

/** Reglas de la configuración (antes de tocar la base). */
function validateGroups(groups: OptionGroupInput[]) {
  for (const g of groups) {
    if (g.options.length === 0) {
      throw HttpError.badRequest(`El grupo "${g.name}" necesita al menos una opción`);
    }
    const names = g.options.map(o => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw HttpError.badRequest(`Hay opciones repetidas en "${g.name}"`);
    }
    if (g.type === MenuOptionGroupType.SINGLE && g.options.filter(o => o.isDefault).length > 1) {
      throw HttpError.badRequest(`En "${g.name}" solo una opción puede venir elegida de entrada`);
    }
    if (g.type === MenuOptionGroupType.REMOVE && g.required) {
      throw HttpError.badRequest(`"${g.name}" es de ingredientes para sacar: no puede ser obligatorio`);
    }
  }
}

export const menuService = {
  async list(restaurantId: number, opts?: { category?: string; onlyEnabled?: boolean }): Promise<MenuItemWithOptions[]> {
    const items = await prisma.menuItem.findMany({
      where: {
        restaurantId,
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.onlyEnabled ? { enabled: true } : {}),
      },
      include: optionGroupsInclude,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    // Platos que toman el estado del stock de sus insumos (tarea 3.8)
    if (!items.some(i => i.stockAuto)) return items;
    const derived = await stockAutoService.menuStock(restaurantId);
    return items.map(i => {
      const d = i.stockAuto ? derived.get(i.id) : undefined;
      return d ? { ...i, stock: d.status, portionsLeft: d.portions } : i;
    });
  },

  async getById(restaurantId: number, id: number): Promise<MenuItemWithOptions> {
    const item = await prisma.menuItem.findFirst({ where: { id, restaurantId }, include: optionGroupsInclude });
    if (!item) throw HttpError.notFound('Item de menú no encontrado');
    return item;
  },

  async create(restaurantId: number, data: CreateMenuItemData): Promise<MenuItemWithOptions> {
    const item = await prisma.menuItem.create({
      data: {
        restaurantId,
        name: data.name,
        category: data.category,
        price: data.price,
        description: data.description ?? null,
        stock: data.stock ?? StockStatus.IN_STOCK,
        enabled: data.enabled ?? true,
        imageUrl: data.imageUrl ?? null,
      },
      include: optionGroupsInclude,
    });
    emitCreated(restaurantId, item);
    return item;
  },

  async update(restaurantId: number, id: number, data: UpdateMenuItemData): Promise<MenuItemWithOptions> {
    const current = await menuService.getById(restaurantId, id);
    const linkChanged = data.largeVersionId !== undefined && data.largeVersionId !== current.largeVersionId;
    const item = await prisma.$transaction(async (tx) => {
      if (linkChanged && data.largeVersionId) await assertLargeVersion(tx, restaurantId, id, data.largeVersionId);
      const updated = await tx.menuItem.update({
        where: { id },
        data: {
          ...(linkChanged ? { largeVersionId: data.largeVersionId } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.price !== undefined ? { price: data.price } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.stock !== undefined ? { stock: data.stock } : {}),
          ...(data.stockAuto !== undefined ? { stockAuto: data.stockAuto } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        },
        include: optionGroupsInclude,
      });
      // Cambio de precio: queda registrado quién y de cuánto a cuánto
      if (toCents(current.price) !== toCents(updated.price)) {
        await audit(tx, {
          restaurantId, action: 'menu.price', entity: 'MenuItem', entityId: id,
          before: { name: current.name, price: current.price },
          after: { name: updated.name, price: updated.price },
        });
      }
      if (linkChanged) {
        await audit(tx, {
          restaurantId, action: 'menu.large_version', entity: 'MenuItem', entityId: id,
          before: { name: current.name, largeVersionId: current.largeVersionId },
          after: { name: updated.name, largeVersionId: updated.largeVersionId },
        });
      }
      return updated;
    }).catch((err: unknown) => {
      // Dos administradores vinculando el mismo plato a la vez
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw HttpError.conflict('Ese plato ya es la versión grande de otro');
      }
      throw err;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /**
   * Reemplaza la configuración de opciones del plato. Conserva los ids de los
   * grupos y opciones que siguen (así un pedido que se está tomando con la
   * pantalla abierta no falla) y borra los que se sacaron. Los pedidos y ventas
   * ya hechos no cambian: guardan su propia copia de lo elegido.
   */
  async saveOptions(restaurantId: number, menuItemId: number, groups: OptionGroupInput[]): Promise<MenuItemWithOptions> {
    validateGroups(groups);

    await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.findFirst({ where: { id: menuItemId, restaurantId }, include: optionGroupsInclude });
      if (!item) throw HttpError.notFound('Item de menú no encontrado');
      const beforeSummary = optionsSummary(item.optionGroups);

      const existing = new Map(item.optionGroups.map(g => [g.id, g]));
      const keptGroupIds = groups.map(g => g.id).filter((id): id is number => id !== undefined && existing.has(id));
      await tx.menuItemOptionGroup.deleteMany({ where: { menuItemId, id: { notIn: keptGroupIds } } });

      for (const [gi, g] of groups.entries()) {
        const current = g.id !== undefined ? existing.get(g.id) : undefined;
        const groupData = { name: g.name, type: g.type, required: g.required, sortOrder: gi };
        const group = current
          ? await tx.menuItemOptionGroup.update({ where: { id: current.id }, data: groupData })
          : await tx.menuItemOptionGroup.create({ data: { ...groupData, restaurantId, menuItemId } });

        const currentOptionIds = new Set(current?.options.map(o => o.id) ?? []);
        const keptOptionIds = g.options.map(o => o.id).filter((id): id is number => id !== undefined && currentOptionIds.has(id));
        await tx.menuItemOption.deleteMany({ where: { groupId: group.id, id: { notIn: keptOptionIds } } });

        for (const [oi, o] of g.options.entries()) {
          const optionData = {
            name: o.name,
            // Sacar un ingrediente no cambia el precio
            priceDelta: g.type === MenuOptionGroupType.REMOVE ? 0 : o.priceDelta,
            // En "sacar" todo viene incluido de entrada: isDefault no aplica
            isDefault: g.type === MenuOptionGroupType.REMOVE ? false : o.isDefault,
            sortOrder: oi,
          };
          if (o.id !== undefined && currentOptionIds.has(o.id)) {
            await tx.menuItemOption.update({ where: { id: o.id }, data: optionData });
          } else {
            await tx.menuItemOption.create({ data: { ...optionData, groupId: group.id } });
          }
        }
      }

      const saved = await tx.menuItem.findFirstOrThrow({ where: { id: menuItemId }, include: optionGroupsInclude });
      const afterSummary = optionsSummary(saved.optionGroups);
      if (JSON.stringify(beforeSummary) !== JSON.stringify(afterSummary)) {
        await audit(tx, {
          restaurantId, action: 'menu.options', entity: 'MenuItem', entityId: menuItemId,
          before: { name: item.name, groups: beforeSummary },
          after: { name: item.name, groups: afterSummary },
        });
      }
    });

    const updated = await menuService.getById(restaurantId, menuItemId);
    emitChanged(restaurantId, updated);
    return updated;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    const current = await menuService.getById(restaurantId, id);
    // Los ítems de pedidos y ventas guardan nombre, precio y opciones propios
    // (FK con SetNull): borrar el plato no altera el histórico.
    await prisma.$transaction(async (tx) => {
      await tx.menuItem.delete({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'menu.delete', entity: 'MenuItem', entityId: id,
        before: { name: current.name, category: current.category, price: current.price },
      });
    });
    emitDeleted(restaurantId, id);
  },

  async toggleEnabled(restaurantId: number, id: number): Promise<MenuItemWithOptions> {
    const current = await menuService.getById(restaurantId, id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { enabled: !current.enabled },
      include: optionGroupsInclude,
    });
    emitChanged(restaurantId, item);
    return item;
  },

  async setStock(restaurantId: number, id: number, stock: StockStatus): Promise<MenuItemWithOptions> {
    await menuService.getById(restaurantId, id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { stock },
      include: optionGroupsInclude,
    });
    emitChanged(restaurantId, item);
    return item;
  },
};
