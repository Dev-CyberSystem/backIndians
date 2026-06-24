import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { logger } from '../utils/logger';

/**
 * Limitadores de tasa (express-rate-limit). Protegen endpoints públicos del abuso.
 * Cuenta por IP en una ventana de tiempo; al excederse responde 429 y registra un
 * WARN (con el transactionId de la request) para detectar patrones de abuso.
 */
function createLimiter(
  name: string,
  windowMs: number,
  limit: number,
  extra: Partial<Options> = {},
) {
  const options: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit-* headers
    legacyHeaders: false,
    handler: (req, res) => {
      const r = req as Request & { transactionId?: string };
      logger.warn(`rateLimit.${name}`, {
        request: { method: req.method, url: req.originalUrl },
        meta: { ip: req.ip, transactionId: r.transactionId, limit, windowMs },
        message: `Límite de tasa excedido en ${name}`,
      });
      res.status(429).json({ success: false, message: 'Demasiadas solicitudes. Intentá más tarde.' });
    },
    ...extra,
  };
  return rateLimit(options);
}

// Los límites de autenticación se desactivan bajo Jest para no bloquear la suite
// (que hace muchos logins). El de logs sigue activo para poder testearlo.
const skipUnderTest = () => process.env.JEST_WORKER_ID !== undefined;

/** Ingesta de logs del cliente: 60 eventos por minuto por IP. */
export const clientLogsLimiter = createLimiter('clientLogs', 60_000, 60);

/**
 * Login: 10 intentos FALLIDOS cada 15 min por IP (contra fuerza bruta de
 * contraseñas). `skipSuccessfulRequests` hace que un login válido no consuma el
 * cupo, así un usuario legítimo en una IP compartida no queda bloqueado.
 */
export const authLimiter = createLimiter('auth', 15 * 60_000, 10, {
  skipSuccessfulRequests: true,
  skip: skipUnderTest,
});

/**
 * Recupero de contraseña: 5 solicitudes por hora por IP (evita spam de emails y
 * enumeración de cuentas a gran escala).
 */
export const passwordResetLimiter = createLimiter('passwordReset', 60 * 60_000, 5, {
  skip: skipUnderTest,
});

export { createLimiter };
