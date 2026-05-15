import { Request, Response, NextFunction } from 'express';
import {
  loginService,
  refreshTokenService,
  getMeService,
  forgotPasswordService,
  resetPasswordService,
} from '../services/auth.service';
import { AuthRequest } from '../types';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;
    const { user, tokens } = await loginService(email, password);

    res.json({
      success: true,
      data: { user, ...tokens },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body;
    const tokens = await refreshTokenService(refreshToken);

    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
}

// El logout se maneja en el cliente eliminando los tokens.
// En producción se podría implementar una blacklist de tokens con Redis.
export function logout(_req: Request, res: Response): void {
  res.json({ success: true, data: { message: 'Sesión cerrada correctamente' } });
}

export async function me(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getMeService(req.user!.id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

// Siempre responde 200 para no revelar si el email existe en el sistema
export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await forgotPasswordService(req.body.email);
    res.json({
      success: true,
      data: { message: 'Si el email existe, recibirás un enlace para restablecer tu contraseña.' },
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, newPassword } = req.body;
    await resetPasswordService(token, newPassword);
    res.json({ success: true, data: { message: 'Contraseña actualizada correctamente.' } });
  } catch (err) {
    next(err);
  }
}
