import { Request, Response, NextFunction } from 'express';
import { verifyStoreToken } from '../services/store.auth.service';
import { AppError } from './errorHandler';

declare global {
  namespace Express {
    interface Request {
      storeCustomerId?: number;
      storeCustomerEmail?: string;
    }
  }
}

export function requireStoreAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError('Sin autenticación', 401));

  try {
    const payload = verifyStoreToken(header.slice(7));
    req.storeCustomerId = payload.sub;
    req.storeCustomerEmail = payload.email;
    next();
  } catch (err) {
    next(err);
  }
}

export function optionalStoreAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyStoreToken(header.slice(7));
      req.storeCustomerId = payload.sub;
      req.storeCustomerEmail = payload.email;
    } catch {
      // token inválido pero no bloqueamos — es opcional
    }
  }
  next();
}
