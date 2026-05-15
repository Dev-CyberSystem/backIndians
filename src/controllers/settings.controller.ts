import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as settingsService from '../services/settings.service';

export async function getSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await settingsService.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

export async function updateSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await settingsService.updateSettings(req.body);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}
