import { Op, QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../config/db';
import { StockItem, StockCategory, StockMovement, User } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { JwtPayload } from '../types';

// ── Dropdown de telas disponibles (para selección en pedidos) ────────────────

export async function getAvailableForDropdown() {
  return StockItem.findAll({
    where: { active: true, current_quantity: { [Op.gt]: 0 } },
    attributes: ['id', 'name', 'unit', 'current_quantity'],
    order: [['name', 'ASC']],
  });
}

// ── Categorías ────────────────────────────────────────────────────────────────

export async function listCategories() {
  return StockCategory.findAll({ order: [['name', 'ASC']] });
}

export async function createCategory(name: string, description?: string) {
  return StockCategory.create({ name, description: description || null });
}

export async function updateCategory(id: number, name: string, description?: string) {
  const cat = await StockCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  await cat.update({ name, description: description ?? cat.description });
  return cat;
}

export async function deleteCategory(id: number) {
  const cat = await StockCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  const count = await StockItem.count({ where: { category_id: id, active: true } });
  if (count > 0) throw new AppError(`No se puede eliminar: ${count} materiales usan esta categoría`, 400);
  await cat.destroy();
}

// ── Materiales ────────────────────────────────────────────────────────────────

export interface ListStockOptions {
  page: number;
  limit: number;
  search?: string;
  category_id?: number;
  status?: 'ok' | 'low' | 'empty';
}

const itemIncludes = [
  { model: StockCategory, as: 'category', attributes: ['id', 'name'] },
];

export async function listStockItems(options: ListStockOptions) {
  const { page, limit, search, category_id, status } = options;
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = { active: true };
  if (category_id) where.category_id = category_id;
  if (search) where.name = { [Op.like]: `%${search}%` };

  if (status === 'empty') {
    where.current_quantity = { [Op.lte]: 0 };
  } else if (status === 'low') {
    Object.assign(where, {
      current_quantity: { [Op.gt]: 0 },
      [Op.and]: sequelize.literal('current_quantity <= min_quantity AND min_quantity > 0'),
    });
  } else if (status === 'ok') {
    Object.assign(where, {
      current_quantity: { [Op.gt]: 0 },
      [Op.or]: [
        { min_quantity: { [Op.lte]: 0 } },
        sequelize.literal('current_quantity > min_quantity'),
      ],
    });
  }

  const { rows, count } = await StockItem.findAndCountAll({
    where,
    include: itemIncludes,
    order: [['name', 'ASC']],
    limit,
    offset,
    distinct: true,
  });

  return { items: rows, total: count, page, limit };
}

export async function getStockItem(id: number) {
  const item = await StockItem.findOne({
    where: { id, active: true },
    include: itemIncludes,
  });
  if (!item) throw new AppError('Material no encontrado', 404);
  return item;
}

export async function createStockItem(input: {
  name: string;
  category_id?: number;
  unit: string;
  current_quantity?: number;
  min_quantity?: number;
  description?: string;
}) {
  return StockItem.create({
    name: input.name,
    category_id: input.category_id || null,
    unit: input.unit,
    current_quantity: input.current_quantity ?? 0,
    min_quantity: input.min_quantity ?? 0,
    description: input.description || null,
    active: true,
  });
}

export async function updateStockItem(
  id: number,
  input: Partial<{
    name: string;
    category_id: number | null;
    unit: string;
    min_quantity: number;
    description: string;
  }>
) {
  const item = await StockItem.findByPk(id);
  if (!item) throw new AppError('Material no encontrado', 404);
  await item.update(input);
  return getStockItem(id);
}

export async function deleteStockItem(id: number) {
  const item = await StockItem.findByPk(id);
  if (!item) throw new AppError('Material no encontrado', 404);
  await item.update({ active: false });
}

// ── Movimientos ───────────────────────────────────────────────────────────────

export async function createMovement(
  input: { stock_item_id: number; type: 'in' | 'out' | 'adjustment'; quantity: number; notes?: string },
  currentUser: JwtPayload
) {
  // Verificación previa sin lock (falla rápido si no existe)
  const exists = await StockItem.count({ where: { id: input.stock_item_id } });
  if (!exists) throw new AppError('Material no encontrado', 404);

  await sequelize.transaction(async (t) => {
    // Re-lee dentro de la transacción con lock exclusivo para prevenir race conditions
    const item = await StockItem.findByPk(input.stock_item_id, {
      lock: Transaction.LOCK.UPDATE,
      transaction: t,
    });
    if (!item) throw new AppError('Material no encontrado', 404);

    const prevQty = Number(item.current_quantity);
    let newQty: number;

    if (input.type === 'in') {
      newQty = prevQty + input.quantity;
    } else if (input.type === 'out') {
      newQty = prevQty - input.quantity;
      if (newQty < 0) throw new AppError('Stock insuficiente', 400);
    } else {
      newQty = input.quantity;
    }

    await item.update({ current_quantity: newQty }, { transaction: t });
    await StockMovement.create(
      {
        stock_item_id: input.stock_item_id,
        type: input.type,
        quantity: input.quantity,
        previous_quantity: prevQty,
        new_quantity: newQty,
        notes: input.notes || null,
        user_id: currentUser.id,
      },
      { transaction: t }
    );
  });

  return getStockItem(input.stock_item_id);
}

export async function listMovements(options: {
  stock_item_id?: number;
  page: number;
  limit: number;
}) {
  const { stock_item_id, page, limit } = options;
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (stock_item_id) where.stock_item_id = stock_item_id;

  const { rows, count } = await StockMovement.findAndCountAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'role'] },
      { model: StockItem, as: 'item', attributes: ['id', 'name', 'unit'] },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { movements: rows, total: count, page, limit };
}

// ── Métricas ──────────────────────────────────────────────────────────────────

export async function getMetrics() {
  const rows = await sequelize.query<{
    total: string; ok_count: string; low_count: string; empty_count: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN current_quantity > 0 AND (min_quantity <= 0 OR current_quantity > min_quantity) THEN 1 ELSE 0 END) AS ok_count,
       SUM(CASE WHEN current_quantity > 0 AND min_quantity > 0 AND current_quantity <= min_quantity THEN 1 ELSE 0 END) AS low_count,
       SUM(CASE WHEN current_quantity <= 0 THEN 1 ELSE 0 END) AS empty_count
     FROM stock_items WHERE active = 1`,
    { type: QueryTypes.SELECT }
  );

  const m = rows[0] ?? { total: '0', ok_count: '0', low_count: '0', empty_count: '0' };
  return {
    total:       Number(m.total),
    ok_count:    Number(m.ok_count),
    low_count:   Number(m.low_count),
    empty_count: Number(m.empty_count),
  };
}

export async function getTopUsed(limit = 10) {
  return sequelize.query<{
    item_id: number; item_name: string; unit: string; total_out: string;
  }>(
    `SELECT
       sm.stock_item_id AS item_id,
       si.name AS item_name,
       si.unit,
       SUM(sm.quantity) AS total_out
     FROM stock_movements sm
     JOIN stock_items si ON si.id = sm.stock_item_id
     WHERE sm.type = 'out' AND si.active = 1
     GROUP BY sm.stock_item_id, si.name, si.unit
     ORDER BY total_out DESC
     LIMIT :limit`,
    { replacements: { limit }, type: QueryTypes.SELECT }
  );
}
