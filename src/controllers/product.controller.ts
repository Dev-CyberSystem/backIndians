import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as productService from '../services/product.service';

export async function listProducts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await productService.listProducts(page, limit);
    res.json({
      success: true,
      data: result.products,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function createProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.createProduct(req.body);
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await productService.updateProduct(parseInt(req.params.id), req.body);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await productService.deleteProduct(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Producto desactivado' } });
  } catch (err) { next(err); }
}
