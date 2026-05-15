import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { getDashboardSummary } from '../services/dashboard.service';

export async function summary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getDashboardSummary();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
