import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as stockService from '../services/stock.service';

export async function listStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await stockService.listStockItems(page, limit);
    res.json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function createStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await stockService.createStockItem(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

export async function updateStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await stockService.updateStockItem(parseInt(req.params.id), req.body);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
}

export async function deleteStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await stockService.deleteStockItem(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Item eliminado' } });
  } catch (err) { next(err); }
}
