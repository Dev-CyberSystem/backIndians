import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as cashService from '../services/cash.service';

// ── Cuentas ───────────────────────────────────────────────────────────────────

export async function listAccounts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const accounts = await cashService.listAccounts();
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
}

export async function createAccount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = await cashService.createAccount(req.body);
    res.status(201).json({ success: true, data: account });
  } catch (err) { next(err); }
}

export async function updateAccount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = await cashService.updateAccount(parseInt(req.params.id), req.body);
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

export async function toggleAccount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const account = await cashService.toggleAccount(parseInt(req.params.id));
    res.json({ success: true, data: account });
  } catch (err) { next(err); }
}

// ── Categorías ────────────────────────────────────────────────────────────────

export async function listCategories(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await cashService.listCategories();
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
}

export async function createCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = await cashService.createCategory(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (err) { next(err); }
}

export async function updateCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = await cashService.updateCategory(parseInt(req.params.id), req.body);
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
}

export async function toggleCategory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = await cashService.toggleCategory(parseInt(req.params.id));
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
}

// ── Transacciones ─────────────────────────────────────────────────────────────

export async function listTransactions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 15, 100);

    const result = await cashService.listTransactions({
      page,
      limit,
      account_id:     req.query.account_id     ? parseInt(req.query.account_id as string)  : undefined,
      category_id:    req.query.category_id    ? parseInt(req.query.category_id as string) : undefined,
      type:           req.query.type           as cashService.ListTransactionsOptions['type'] | undefined,
      date_from:      req.query.date_from      as string | undefined,
      date_to:        req.query.date_to        as string | undefined,
      reference_type: req.query.reference_type as 'invoice' | 'order' | undefined,
    });

    res.json({
      success: true,
      data: result.transactions,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function getTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tx = await cashService.getTransaction(parseInt(req.params.id));
    res.json({ success: true, data: tx });
  } catch (err) { next(err); }
}

export async function createTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tx = await cashService.createTransaction(req.body, req.user!);
    res.status(201).json({ success: true, data: tx });
  } catch (err) { next(err); }
}

export async function updateTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const tx = await cashService.updateTransaction(parseInt(req.params.id), req.body);
    res.json({ success: true, data: tx });
  } catch (err) { next(err); }
}

export async function deleteTransaction(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await cashService.deleteTransaction(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Transacción eliminada y saldo revertido' } });
  } catch (err) { next(err); }
}

// ── Resumen ───────────────────────────────────────────────────────────────────

export async function getSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await cashService.getSummary(req.query.period as string | undefined);
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
}
