import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JwtPayload } from '../types';
import { AppError } from './errorHandler';
import { User } from '../models';

export async function authenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Token de autenticación requerido', 401));
  }

  const token = authHeader.split(' ')[1];

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expirado', 401));
    }
    return next(new AppError('Token inválido', 401));
  }

  // Validar que la sesión sigue vigente en DB (detecta login desde otro dispositivo)
  const user = await User.findByPk(payload.id, {
    attributes: ['id', 'active', 'session_version'],
  });

  if (!user || !user.active) {
    return next(new AppError('Usuario inactivo o no encontrado', 401));
  }

  if ((user.session_version as number) !== payload.session_version) {
    return next(new AppError('Sesión cerrada desde otro dispositivo', 401));
  }

  req.user = payload;
  next();
}
