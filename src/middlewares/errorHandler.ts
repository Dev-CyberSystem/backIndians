import { Request, Response, NextFunction } from 'express';
import { ValidationError } from 'sequelize';
import { logger } from '../utils/logger';
import type { LogContext } from '../types/logging';

// Error personalizado con código HTTP y, opcionalmente, código/tipo de negocio.
export class AppError extends Error {
  /** Código de negocio (ej: 'INSUFFICIENT_FUNDS') o, si no, el HTTP status. */
  public code?: string | number;
  /** Tipo del error para clasificar en los logs (ej: 'BusinessRuleError'). */
  public type?: string;
  /** Error original, si este fue wrapeado. */
  public originalError?: unknown;

  constructor(
    public message: string,
    public statusCode: number = 500,
    public errors?: unknown[],
    options?: { code?: string | number; type?: string; originalError?: unknown }
  ) {
    super(message);
    this.name = 'AppError';
    this.code = options?.code ?? statusCode;
    this.type = options?.type ?? 'AppError';
    this.originalError = options?.originalError;
  }
}

/** Arma el contexto de log a partir de la request (operador, request, transacción). */
function buildLogContext(req: Request): LogContext {
  const r = req as Request & {
    user?: { id?: number; email?: string; role?: string; session_version?: number };
    transactionId?: string;
    correlationId?: string;
    startTime?: number;
  };
  return {
    transactionId: r.transactionId,
    operator: r.user
      ? {
          id: r.user.id,
          name: r.user.email,
          role: r.user.role,
          sessionId: r.user.session_version != null ? String(r.user.session_version) : undefined,
        }
      : undefined,
    request: {
      method: req.method,
      url: req.originalUrl,
      payload: req.method === 'GET' ? undefined : req.body, // sanitize() lo limpia en el logger
    },
    meta: {
      correlationId: r.correlationId ?? r.transactionId,
      duration: r.startTime ? Date.now() - r.startTime : undefined,
    },
  };
}

// Middleware centralizado de manejo de errores
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const ctx = buildLogContext(req);

  // Errores de validación de Sequelize → 422 (WARN: es un error esperable del input)
  if (err instanceof ValidationError) {
    logger.warn('db.validation', {
      ...ctx,
      message: 'Error de validación en base de datos',
      meta: { ...ctx.meta, fields: err.errors.map((e) => e.path) },
    });
    res.status(422).json({
      success: false,
      message: 'Error de validación en base de datos',
      errors: err.errors.map((e) => ({ field: e.path, message: e.message })),
    });
    return;
  }

  // Errores propios de la aplicación
  if (err instanceof AppError) {
    const operationName = err.type || 'AppError';
    // 4xx = error de negocio/cliente (WARN); 5xx = falla real (ERROR).
    if (err.statusCode >= 500) {
      logger.error(operationName, err, ctx);
    } else {
      logger.warn(operationName, { ...ctx, message: err.message, meta: { ...ctx.meta, code: err.code } });
    }
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  // Error genérico inesperado — se registra completo (con stack fuera de prod).
  logger.error('unhandledError', err, ctx);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Error interno del servidor',
  });
}
