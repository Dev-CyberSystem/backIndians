import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as costService from '../services/cost.service';

// GET /costs/items?category=jersey|shorts
export async function listCostItems(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = req.query.category as 'jersey' | 'shorts';
    const items = await costService.listCostItems(category);
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

// GET /costs/clients/:clientId
export async function listClientCostSheets(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.listClientCostSheets(parseInt(req.params.clientId));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /costs/clients/:clientId/garments/:garmentTypeId
export async function getCostSheet(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.getCostSheet(
      parseInt(req.params.clientId), parseInt(req.params.garmentTypeId)
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// PUT /costs/clients/:clientId/garments/:garmentTypeId
export async function saveCostSheet(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.saveCostSheet(
      parseInt(req.params.clientId),
      parseInt(req.params.garmentTypeId),
      req.body.items ?? [],
      req.user!
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /costs/clients/:clientId/garments/:garmentTypeId/history
export async function getCostHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.getCostHistory(
      parseInt(req.params.clientId), parseInt(req.params.garmentTypeId)
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /costs/preview  { client_id, items: [{ garment_type_id, quantity }] }
export async function previewOrderCosts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.previewOrderCosts(
      parseInt(req.body.client_id), req.body.items ?? []
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /costs/orders/:orderId
export async function getOrderCostDetails(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await costService.getOrderCostDetails(parseInt(req.params.orderId));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
