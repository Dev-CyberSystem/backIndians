import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { clientLogsLimiter } from '../middlewares/rateLimit';

/**
 * Ingesta de logs del cliente (frontend React). Los errores capturados por el
 * ErrorBoundary / window.onerror se envían acá y se registran con el MISMO logger
 * central, de modo que terminan en el mismo pipeline (Datadog/ELK/CloudWatch).
 *
 * Es público (un error puede ocurrir antes del login). El nivel se restringe a
 * error/warn/info, el contenido se sanitiza en el logger y se aplica un
 * rate-limit (60/min por IP) para evitar abuso.
 */
const router = Router();

const ALLOWED = new Set(['error', 'warn', 'info']);

router.post('/client', clientLogsLimiter, (req: Request, res: Response) => {
  const r = req as Request & { transactionId?: string; correlationId?: string };
  const { level, operationName, message, error, context } = req.body ?? {};
  const lvl = ALLOWED.has(level) ? (level as 'error' | 'warn' | 'info') : 'error';

  const ctx = {
    ...(context ?? {}),
    meta: {
      ...(context?.meta ?? {}),
      origin: 'client',
      correlationId: r.correlationId,
      userAgent: req.headers['user-agent'],
    },
  };

  if (lvl === 'error') {
    logger.error(`client.${operationName || 'error'}`, error ?? new Error(message || 'Client error'), ctx);
  } else {
    logger[lvl](`client.${operationName || lvl}`, { ...ctx, message: message || operationName });
  }

  res.status(204).end();
});

export default router;
