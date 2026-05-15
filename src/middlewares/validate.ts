import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

// Middleware que lee el resultado de express-validator y devuelve errores en formato estándar
export function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      message: 'Datos inválidos',
      errors: errors.array(),
    });
    return;
  }

  next();
}
