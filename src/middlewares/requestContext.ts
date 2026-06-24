import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger, LoggerService } from '../utils/logger';

/**
 * Asigna a cada request un identificador de transacción y un logger hijo con el
 * contexto ya cargado (transactionId, correlationId). Reusa el `x-correlation-id`
 * entrante para trazar entre servicios; si no viene, genera un UUID v4.
 *
 * Deja disponible:
 *   - req.transactionId / req.correlationId / req.startTime
 *   - req.log → LoggerService con el contexto de la transacción
 * y devuelve el `x-correlation-id` en la respuesta.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const r = req as Request & {
    transactionId?: string;
    correlationId?: string;
    startTime?: number;
    log?: LoggerService;
  };

  const incoming = (req.headers['x-correlation-id'] || req.headers['x-request-id']) as string | undefined;
  const transactionId = uuidv4();
  const correlationId = incoming || transactionId;

  r.transactionId = transactionId;
  r.correlationId = correlationId;
  r.startTime = Date.now();
  r.log = logger.child({ transactionId, meta: { correlationId } });

  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-transaction-id', transactionId);

  // Access log al finalizar (INFO → no se emite en producción; allí solo errores).
  res.on('finish', () => {
    r.log?.info('http.request', {
      request: { method: req.method, url: req.originalUrl },
      meta: {
        correlationId,
        statusCode: res.statusCode,
        duration: r.startTime ? Date.now() - r.startTime : undefined,
      },
    });
  });

  next();
}
