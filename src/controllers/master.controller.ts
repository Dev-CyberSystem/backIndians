import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as masterService from '../services/master.service';

// ─── GarmentType ──────────────────────────────────────────────────────────────

export async function listGarmentTypes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await masterService.listGarmentTypes();
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function createGarmentType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.createGarmentType(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

export async function updateGarmentType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.updateGarmentType(parseInt(req.params.id), req.body);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
}

// ─── FabricType ───────────────────────────────────────────────────────────────

export async function listFabricTypes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await masterService.listFabricTypes();
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function createFabricType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.createFabricType(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

export async function updateFabricType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.updateFabricType(parseInt(req.params.id), req.body);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
}

// ─── SizeChart ────────────────────────────────────────────────────────────────

export async function listSizes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await masterService.listSizes();
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
}

export async function createSize(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.createSize(req.body);
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
}

export async function updateSize(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await masterService.updateSize(parseInt(req.params.id), req.body);
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
}
