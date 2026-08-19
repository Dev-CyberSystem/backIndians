import { Request, Response, NextFunction } from 'express';
import * as legal from '../services/legal.service';
import { AuthRequest } from '../types';
import type { WithdrawalStatus } from '../models/StoreWithdrawalRequest';

/**
 * Textos legales de la tienda: versiones vigentes, solicitudes de
 * arrepentimiento (Res. 424/2020) y consulta de constancias de aceptación.
 *
 * Los textos en sí viven en el frontend; acá solo viaja la versión vigente,
 * que es la que se estampa en cada constancia.
 */

// ─── Público ────────────────────────────────────────────────────────────────

export function getLegalDocuments(_req: Request, res: Response): void {
  res.json({ success: true, data: legal.getLegalDocumentsMeta() });
}

export async function createWithdrawal(req: Request, res: Response, next: NextFunction) {
  try {
    const request = await legal.createWithdrawalRequest({
      customer_name: req.body.customer_name,
      customer_email: req.body.customer_email,
      customer_phone: req.body.customer_phone,
      order_number: req.body.order_number,
      reason: req.body.reason,
      customerId: req.storeCustomerId ?? null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // Solo el código y la fecha: la respuesta es pública (no hay login detrás)
    // y no tiene por qué devolver los datos que ya mandó quien la envió.
    res.status(201).json({
      success: true,
      data: { code: request.code, created_at: request.createdAt, status: request.status },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function listWithdrawals(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await legal.listWithdrawalRequests({
      status: req.query.status as WithdrawalStatus | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function getWithdrawal(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const request = await legal.getWithdrawalRequest(Number(req.params.id));
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
}

export async function updateWithdrawal(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const request = await legal.updateWithdrawalRequest(
      Number(req.params.id),
      { status: req.body.status, admin_notes: req.body.admin_notes },
      req.user!.id
    );
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
}

export async function listAcceptances(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await legal.listLegalAcceptances({
      customer_id: req.query.customer_id ? Number(req.query.customer_id) : undefined,
      store_order_id: req.query.store_order_id ? Number(req.query.store_order_id) : undefined,
      email: req.query.email as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    next(err);
  }
}
