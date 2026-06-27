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

// Los límites se desactivan bajo Jest (la suite hace muchos logins/checkouts) y
// cuando se corre un test de carga local (RATE_LIMIT_DISABLED=1), porque autocannon
// pega desde una sola IP y un límite por-IP falsearía la medición. En producción
// el tráfico real viene de muchas IPs, así que el límite por-IP no molesta.
// El limitador de logs queda SIEMPRE activo para poder testearlo.
const rateLimitDisabled = () =>
  process.env.JEST_WORKER_ID !== undefined || process.env.RATE_LIMIT_DISABLED === '1';

/** Ingesta de logs del cliente: 60 eventos por minuto por IP. */
export const clientLogsLimiter = createLimiter('clientLogs', 60_000, 60);

/**
 * Backstop general para toda la API: 500 req/min por IP. Es un cortafuegos anti-DoS
 * de bajo esfuerzo / scraping agresivo; un humano navegando (incluso varios detrás de
 * un NAT) no se acerca a ese número. Las rutas sensibles tienen además su propio límite.
 */
export const generalLimiter = createLimiter('general', 60_000, 500, { skip: rateLimitDisabled });

/** Checkout público: 25 pedidos cada 15 min por IP (evita spam de pedidos y agotar stock por bots). */
export const checkoutLimiter = createLimiter('checkout', 15 * 60_000, 25, { skip: rateLimitDisabled });

/** Validar cupón: 40 cada 10 min por IP (evita adivinar códigos por fuerza bruta). */
export const couponLimiter = createLimiter('coupon', 10 * 60_000, 40, { skip: rateLimitDisabled });

/** Subir comprobante de transferencia: 15 por hora por IP (operación cara: sube a Cloudinary). */
export const paymentProofLimiter = createLimiter('paymentProof', 60 * 60_000, 15, { skip: rateLimitDisabled });

/** Confirmar/consultar estado de pago (polling público): 120 por minuto por IP. */
export const paymentStatusLimiter = createLimiter('paymentStatus', 60_000, 120, { skip: rateLimitDisabled });

/** Tracking de analítica (fire & forget, dispara en cada interacción): 240/min por IP. */
export const trackLimiter = createLimiter('track', 60_000, 240, { skip: rateLimitDisabled });

/**
 * Login: 10 intentos FALLIDOS cada 15 min por IP (contra fuerza bruta de
 * contraseñas). `skipSuccessfulRequests` hace que un login válido no consuma el
 * cupo, así un usuario legítimo en una IP compartida no queda bloqueado.
 */
export const authLimiter = createLimiter('auth', 15 * 60_000, 10, {
  skipSuccessfulRequests: true,
  skip: rateLimitDisabled,
});

/**
 * Recupero de contraseña: 5 solicitudes por hora por IP (evita spam de emails y
 * enumeración de cuentas a gran escala).
 */
export const passwordResetLimiter = createLimiter('passwordReset', 60 * 60_000, 5, {
  skip: rateLimitDisabled,
});

export { createLimiter };
