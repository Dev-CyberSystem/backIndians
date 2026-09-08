import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as supplierService from '../services/supplier.service';

export async function list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(
      parseInt((req.query.limit ?? req.query.per_page) as string) || 24,
      200
    );
    const { rows, count } = await supplierService.listSuppliers({
      search: (req.query.search as string) || undefined,
      category: (req.query.category as string) || undefined,
      includeInactive: req.query.include_inactive === 'true',
      page,
      limit,
    });
    res.json({
      success: true,
      data: rows,
      meta: { page, limit, total: count },
    });
  } catch (err) { next(err); }
}

export async function categories(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await supplierService.listSupplierCategories();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplier = await supplierService.getSupplier(parseInt(req.params.id));
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplier = await supplierService.createSupplier(req.body, req.user?.id);
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplier = await supplierService.updateSupplier(
      parseInt(req.params.id),
      req.body,
      req.user?.id
    );
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
}

/** Activa/desactiva según `active` en el body (baja lógica). */
export async function setStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const supplier = await supplierService.setSupplierActive(
      parseInt(req.params.id),
      req.body.active === true || req.body.active === 'true'
    );
    res.json({ success: true, data: supplier });
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await supplierService.deleteSupplier(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Proveedor eliminado' } });
  } catch (err) { next(err); }
}
