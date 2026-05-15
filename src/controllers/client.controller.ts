import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as clientService from '../services/client.service';

export async function listClients(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await clientService.listClients(page, limit);
    res.json({
      success: true,
      data: result.clients,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function createClient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = await clientService.createClient(req.body);
    res.status(201).json({ success: true, data: client });
  } catch (err) { next(err); }
}

export async function updateClient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const client = await clientService.updateClient(parseInt(req.params.id), req.body);
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
}

export async function deleteClient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await clientService.deleteClient(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Cliente eliminado' } });
  } catch (err) { next(err); }
}
