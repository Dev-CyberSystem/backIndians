/**
 * Tipos del sistema de logging estructurado (NDJSON, apto para Datadog/ELK/CloudWatch).
 * Cada entrada de ERROR captura el contexto completo para reproducir y diagnosticar
 * un problema sin información adicional.
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export type Environment = 'production' | 'staging' | 'development' | 'test';

/** Operador: usuario autenticado que ejecutó la operación. */
export interface OperatorContext {
  id?: string | number;
  name?: string;
  role?: string;
  sessionId?: string;
}

/** Cliente: entidad de dominio afectada por la operación. */
export interface CustomerContext {
  id?: string | number;
  name?: string;
  accountNumber?: string;
  segment?: string;
}

/** Detalle del error. `stack`/`originalError` solo se incluyen fuera de producción. */
export interface ErrorDetail {
  message: string;
  code?: string | number;
  type?: string;
  stack?: string;
  originalError?: unknown;
}

/** Contexto técnico de la request HTTP (si aplica). */
export interface RequestContext {
  method?: string;
  url?: string;
  /** Payload de la operación; SIEMPRE pasar por sanitize() antes de loguear. */
  payload?: unknown;
}

/** Metadatos de ejecución y trazabilidad. */
export interface MetaContext {
  duration?: number;
  retryCount?: number;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Contexto que se adjunta a un log. Todos los campos son opcionales para poder
 * componerlos con `logger.child(...)` y completarlos por capa (request, servicio…).
 */
export interface LogContext {
  transactionId?: string;
  operationName?: string;
  operator?: OperatorContext;
  customer?: CustomerContext;
  request?: RequestContext;
  meta?: MetaContext;
}

/** Forma final de una entrada de log de error (lo que se serializa a NDJSON). */
export interface StructuredLog extends LogContext {
  level: LogLevel;
  timestamp: string;
  environment: Environment;
  error?: ErrorDetail;
}
