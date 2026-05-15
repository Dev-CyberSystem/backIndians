import { Response, NextFunction } from 'express';
import { AuthRequest, UserRole } from '../types';
import { AppError } from './errorHandler';

// Factory que retorna un middleware de autorización por roles
export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Acceso denegado. Roles permitidos: ${roles.join(', ')}`,
          403
        )
      );
    }

    next();
  };
}
