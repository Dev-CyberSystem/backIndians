import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { getDashboardSummary, getSellerStats } from '../services/dashboard.service';

export async function summary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { period } = req.query as Record<string, string>;
    const data = await getDashboardSummary(period || undefined);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function sellerStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { seller_id, month, sort_by } = req.query as Record<string, string>;
    const data = await getSellerStats({
      seller_id: seller_id ? Number(seller_id) : undefined,
      month: month || undefined,
      sort_by: sort_by || 'revenue',
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
