import pino, { type Logger as PinoLogger } from 'pino';
import { sanitize } from './sanitize';
import type { LogContext, ErrorDetail, Environment } from '../types/logging';

/**
 * Logger estructurado centralizado (Pino). Único punto de entrada para logs en
 * todo el backend: no usar console.* en código de negocio.
 *
 * - Salida NDJSON (una línea JSON por entrada) en staging/producción, lista para
 *   Datadog / ELK / Splunk / CloudWatch.
 * - En desarrollo: formato legible con colores e indentación (pino-pretty).
 * - Niveles: ERROR, WARN, INFO, DEBUG. En producción solo se emiten ERROR y WARN.
 * - Contexto base inmutable con `logger.child({ ... })`.
 */

function resolveEnv(): Environment {
  const e = (process.env.NODE_ENV || 'development').toLowerCase();
  if (e === 'production' || e === 'staging' || e === 'test') return e;
  return 'development';
}

const ENV = resolveEnv();

// En producción solo ERROR/WARN; staging incluye INFO; dev/test todo.
function resolveLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (ENV === 'production') return 'warn';
  if (ENV === 'staging') return 'info';
  return 'debug';
}

const isDev = ENV === 'development';

const basePino = pino({
  level: resolveLevel(),
  // Reemplaza el {pid, hostname} por defecto con campos fijos del servicio.
  base: { environment: ENV, service: process.env.SERVICE_NAME || 'indians-backend' },
  // timestamp ISO 8601 en UTC bajo la clave "timestamp".
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  // Niveles en mayúscula (ERROR/WARN/INFO/DEBUG) en vez de los numéricos de pino.
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  // Segunda capa de defensa por si algún campo no pasó por sanitize().
  redact: {
    paths: [
      'password', '*.password', '*.*.password',
      'token', '*.token', '*.accessToken', '*.refreshToken',
      'authorization', '*.authorization',
      'cvv', '*.cvv', 'password_hash', '*.password_hash',
      'req.headers.authorization', 'req.headers.cookie',
    ],
    censor: '[REDACTED]',
    remove: false,
  },
  // Formato lindo solo en desarrollo.
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: false,
          translateTime: false,
          ignore: 'pid,hostname,service',
        },
      }
    : undefined,
});

const includeStack = ENV !== 'production';

/** Convierte cualquier error capturado en un ErrorDetail estructurado. */
function toErrorDetail(error: unknown): ErrorDetail {
  if (error instanceof Error) {
    const anyErr = error as Error & { code?: string | number; type?: string; originalError?: unknown };
    return {
      message: error.message,
      code: anyErr.code,
      type: anyErr.type || error.name || 'Error',
      stack: includeStack ? error.stack : undefined,
      originalError: anyErr.originalError ? sanitize(anyErr.originalError) : undefined,
    };
  }
  return { message: String(error), type: 'UnknownError' };
}

/** Merge profundo (un nivel) de los sub-objetos de contexto, sin claves duplicadas. */
function mergeContext(a: LogContext, b: LogContext): LogContext {
  return {
    ...a,
    ...b,
    operator: a.operator || b.operator ? { ...a.operator, ...b.operator } : undefined,
    customer: a.customer || b.customer ? { ...a.customer, ...b.customer } : undefined,
    request: a.request || b.request ? { ...a.request, ...b.request } : undefined,
    meta: a.meta || b.meta ? { ...a.meta, ...b.meta } : undefined,
  };
}

export class LoggerService {
  constructor(
    private readonly log: PinoLogger,
    /** Contexto base inmutable, mergeado en cada entrada. */
    private readonly baseContext: LogContext = {},
  ) {}

  /** Crea un logger hijo con contexto base inmutable (se hereda en cada llamada). */
  child(context: LogContext): LoggerService {
    return new LoggerService(this.log, mergeContext(this.baseContext, context));
  }

  private emit(
    level: 'error' | 'warn' | 'info' | 'debug',
    operationName: string,
    context: LogContext,
    message: string,
    error?: unknown,
  ): void {
    const merged = sanitize(mergeContext(this.baseContext, context)) as object;
    const payload = error !== undefined
      ? { operationName, ...merged, error: toErrorDetail(error) }
      : { operationName, ...merged };
    this.log[level](payload, message);
  }

  /** Log de error: adjunta el detalle del error + todo el contexto disponible. */
  error(operationName: string, error: unknown, context: LogContext = {}): void {
    this.emit('error', operationName, context, toErrorDetail(error).message, error);
  }

  warn(operationName: string, context: LogContext & { message?: string } = {}): void {
    const { message, ...ctx } = context;
    this.emit('warn', operationName, ctx, message ?? operationName);
  }

  info(operationName: string, context: LogContext & { message?: string } = {}): void {
    const { message, ...ctx } = context;
    this.emit('info', operationName, ctx, message ?? operationName);
  }

  debug(operationName: string, context: LogContext & { message?: string } = {}): void {
    const { message, ...ctx } = context;
    this.emit('debug', operationName, ctx, message ?? operationName);
  }

  /** Acceso al pino subyacente (para integraciones como pino-http). */
  get raw(): PinoLogger {
    return this.log;
  }
}

/** Instancia singleton: el único logger de la app. */
export const logger = new LoggerService(basePino);

export default logger;
