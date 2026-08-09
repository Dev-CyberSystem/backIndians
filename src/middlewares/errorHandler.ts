import { Request, Response, NextFunction } from 'express';
import { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } from 'sequelize';
import { logger } from '../utils/logger';
import { recordServerError } from '../utils/errorRateMonitor';
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

  // Choque de unicidad en base → 409 con mensaje claro (UniqueConstraintError
  // extiende ValidationError, por eso va primero).
  if (err instanceof UniqueConstraintError) {
    const fields = Object.keys(err.fields ?? {});
    const isGarmentClientName = fields.includes('name') && fields.includes('client_id');
    logger.warn('db.unique', { ...ctx, message: 'Valor duplicado', meta: { ...ctx.meta, fields } });
    res.status(409).json({
      success: false,
      message: isGarmentClientName
        ? 'Ya existe una prenda con ese nombre para este cliente. Usá otro nombre.'
        : 'Ya existe un registro con esos datos (valor duplicado).',
      errors: err.errors.map((e) => ({ field: e.path, message: e.message })),
    });
    return;
  }

  // Referencia a una fila que no existe (o borrado de una fila referenciada)
  // → 400, no 500 (CASH-VAL-006). Enviar un `category_id` inexistente es un
  // error del cliente, no una falla del servidor: devolvía 500 y, en
  // desarrollo, filtraba el mensaje crudo de MySQL con nombres de tabla y
  // constraint. Va antes que `ValidationError` sin ser subclase suya, pero se
  // agrupa acá con el resto de los errores de integridad de base.
  if (err instanceof ForeignKeyConstraintError) {
    logger.warn('db.foreignKey', {
      ...ctx,
      message: 'Referencia inexistente',
      meta: { ...ctx.meta, table: err.table, fields: err.fields },
    });
    res.status(400).json({
      success: false,
      message: 'Uno de los registros referenciados no existe o está en uso.',
    });
    return;
  }

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
      recordServerError({ method: req.method, url: req.originalUrl, message: err.message });
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
  // Alimenta el detector de 5xx sostenidos (C7): no se espera a propósito, para
  // no demorar la respuesta al cliente por mandar un aviso.
  recordServerError({ method: req.method, url: req.originalUrl, message: err.message });
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Error interno del servidor',
  });
}
