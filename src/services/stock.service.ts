import { StockItem } from '../models';
import { AppError } from '../middlewares/errorHandler';

interface StockItemInput {
  name: string;
  category?: string;
  unit: string;
  current_quantity?: number;
  min_quantity?: number;
}

export async function listStockItems(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const { rows, count } = await StockItem.findAndCountAll({
    order: [['name', 'ASC']],
    limit,
    offset,
  });
  return { items: rows, total: count, page, limit };
}

export async function createStockItem(input: StockItemInput): Promise<StockItem> {
  return StockItem.create({
    name: input.name,
    category: input.category || null,
    unit: input.unit,
    current_quantity: input.current_quantity ?? 0,
    min_quantity: input.min_quantity ?? 0,
  });
}

export async function updateStockItem(
  id: number,
  input: Partial<StockItemInput>
): Promise<StockItem> {
  const item = await StockItem.findByPk(id);
  if (!item) throw new AppError('Item de stock no encontrado', 404);
  await item.update(input);
  return item;
}

export async function deleteStockItem(id: number): Promise<void> {
  const item = await StockItem.findByPk(id);
  if (!item) throw new AppError('Item de stock no encontrado', 404);
  await item.destroy();
}
