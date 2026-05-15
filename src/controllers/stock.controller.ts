import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as stockService from '../services/stock.service';

// ── Categorías ────────────────────────────────────────────────────────────────

export async function listCategories(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const cats = await stockService.listCategories();
    res.json({ success: true, data: cats });
  } catch (err) { next(err); }
}

export async function createCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const cat = await stockService.createCategory(req.body.name, req.body.description);
    res.status(201).json({ success: true, data: cat });
  } catch (err) { next(err); }
}

export async function updateCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const cat = await stockService.updateCategory(parseInt(req.params.id), req.body.name, req.body.description);
    res.json({ success: true, data: cat });
  } catch (err) { next(err); }
}

export async function deleteCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await stockService.deleteCategory(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Categoría eliminada' } });
  } catch (err) { next(err); }
}

// ── Materiales ────────────────────────────────────────────────────────────────

export async function listStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page     = parseInt(req.query.page as string) || 1;
    const limit    = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const result = await stockService.listStockItems({
      page,
      limit,
      search:      req.query.search      as string | undefined,
      category_id: req.query.category_id ? parseInt(req.query.category_id as string) : undefined,
      status:      req.query.status      as 'ok' | 'low' | 'empty' | undefined,
    });
    res.json({
      success: true,
      data: result.items,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function getStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await stockService.getStockItem(parseInt(req.params.id));
    res.json({ success: true, data: item });
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
    res.json({ success: true, data: { message: 'Material desactivado' } });
  } catch (err) { next(err); }
}

// ── Movimientos ───────────────────────────────────────────────────────────────

export async function listMovements(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const result = await stockService.listMovements({
      page,
      limit,
      stock_item_id: req.query.stock_item_id ? parseInt(req.query.stock_item_id as string) : undefined,
    });
    res.json({
      success: true,
      data: result.movements,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function createMovement(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await stockService.createMovement(req.body, req.user!);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

// ── Métricas ──────────────────────────────────────────────────────────────────

export async function getMetrics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [metrics, topUsed] = await Promise.all([
      stockService.getMetrics(),
      stockService.getTopUsed(10),
    ]);
    res.json({ success: true, data: { metrics, topUsed } });
  } catch (err) { next(err); }
}
