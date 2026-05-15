import { Request, Response, NextFunction } from 'express';
import { ValidationError } from 'sequelize';

// Error personalizado con código HTTP
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public errors?: unknown[]
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Middleware centralizado de manejo de errores
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Errores de validación de Sequelize
  if (err instanceof ValidationError) {
    res.status(422).json({
      success: false,
      message: 'Error de validación en base de datos',
      errors: err.errors.map((e) => ({ field: e.path, message: e.message })),
    });
    return;
  }

  // Errores propios de la aplicación
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  // Error genérico — no exponer detalles internos en producción
  console.error('Error no controlado:', err);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Error interno del servidor',
  });
}
