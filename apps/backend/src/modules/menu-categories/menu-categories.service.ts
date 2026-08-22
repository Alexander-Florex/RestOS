// ──────────────────────────────────────────────
// menu-categories.service.ts — Categorías del menú (entidad propia)
// ──────────────────────────────────────────────
import type { MenuCategory } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitChanged(restaurantId: number, category: MenuCategory) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_CATEGORY_CHANGED, category);
}
function emitCreated(restaurantId: number, category: MenuCategory) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_CATEGORY_CREATED, category);
}
function emitDeleted(restaurantId: number, id: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_CATEGORY_DELETED, { id });
}

export interface CreateMenuCategoryData {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateMenuCategoryData extends Partial<CreateMenuCategoryData> {}

export const menuCategoriesService = {
  async list(restaurantId: number): Promise<MenuCategory[]> {
    return prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(restaurantId: number, id: number): Promise<MenuCategory> {
    const category = await prisma.menuCategory.findFirst({ where: { id, restaurantId } });
    if (!category) throw HttpError.notFound('Categoría no encontrada');
    return category;
  },

  async create(restaurantId: number, data: CreateMenuCategoryData): Promise<MenuCategory> {
    const exists = await prisma.menuCategory.findFirst({ where: { restaurantId, name: data.name } });
    if (exists) throw HttpError.conflict('Ya existe una categoría con ese nombre');

    const category = await prisma.menuCategory.create({
      data: {
        restaurantId,
        name: data.name,
        color: data.color ?? '#10b981',
        order: data.order ?? 0,
      },
    });
    emitCreated(restaurantId, category);
    return category;
  },

  async update(restaurantId: number, id: number, data: UpdateMenuCategoryData): Promise<MenuCategory> {
    const current = await menuCategoriesService.getById(restaurantId, id);

    if (data.name !== undefined && data.name !== current.name) {
      const exists = await prisma.menuCategory.findFirst({ where: { restaurantId, name: data.name } });
      if (exists) throw HttpError.conflict('Ya existe una categoría con ese nombre');
    }

    const category = await prisma.menuCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });

    // Si se renombró, actualizar el texto libre en los items del menú que la usaban
    if (data.name !== undefined && data.name !== current.name) {
      await prisma.menuItem.updateMany({
        where: { restaurantId, category: current.name },
        data: { category: data.name },
      });
    }

    emitChanged(restaurantId, category);
    return category;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    const category = await menuCategoriesService.getById(restaurantId, id);
    const inUse = await prisma.menuItem.count({ where: { restaurantId, category: category.name } });
    if (inUse > 0) {
      throw HttpError.conflict('No se puede borrar: hay items del menú usando esta categoría');
    }
    await prisma.menuCategory.delete({ where: { id } });
    emitDeleted(restaurantId, id);
  },
};
