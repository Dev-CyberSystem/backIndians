import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Verificación de Cloudflare Turnstile (CAPTCHA) en endpoints públicos sensibles.
 *
 * El widget del frontend genera un token que viaja en `turnstile_token` (body) o en
 * el header `cf-turnstile-response`. Acá lo validamos contra el endpoint de Cloudflare
 * con el secret del servidor.
 *
 * Modo graceful: si `TURNSTILE_SECRET_KEY` no está configurada (dev local, entornos sin
 * claves todavía), se omite la verificación para no romper el flujo. En producción, basta
 * con setear la variable para activarlo. También se omite bajo test/carga.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let warnedMissingSecret = false;

function turnstileDisabled(): boolean {
  return (
    process.env.JEST_WORKER_ID !== undefined ||
    process.env.RATE_LIMIT_DISABLED === '1' ||
    process.env.TURNSTILE_DISABLED === '1'
  );
}

export async function verifyTurnstile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (turnstileDisabled()) return next();

  if (!secret) {
    // Sin secret no podemos verificar; avisamos una vez y dejamos pasar (no bloqueamos
    // el registro real por una variable faltante).
    if (!warnedMissingSecret) {
      logger.warn('turnstile.noSecret', {
        message: 'TURNSTILE_SECRET_KEY no configurada — verificación anti-bot DESACTIVADA',
      });
      warnedMissingSecret = true;
    }
    return next();
  }

  const token =
    (req.body?.turnstile_token as string | undefined) ??
    (req.headers['cf-turnstile-response'] as string | undefined);

  if (!token) {
    res.status(400).json({ success: false, message: 'Falta la verificación anti-bot. Recargá la página e intentá de nuevo.' });
    return;
  }

  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (req.ip) params.append('remoteip', req.ip);

    const resp = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await resp.json()) as { success: boolean; 'error-codes'?: string[] };

    if (!data.success) {
      logger.warn('turnstile.failed', {
        request: { method: req.method, url: req.originalUrl },
        meta: { ip: req.ip, errorCodes: data['error-codes'] },
        message: 'Token de Turnstile inválido',
      });
      res.status(400).json({ success: false, message: 'Verificación anti-bot fallida. Recargá la página e intentá de nuevo.' });
      return;
    }

    next();
  } catch (err) {
    // Si Cloudflare no responde (timeout/red), no bloqueamos al usuario legítimo:
    // registramos y dejamos pasar (fail-open). El rate-limit sigue protegiendo.
    logger.error('turnstile.error', err instanceof Error ? err : new Error(String(err)), {
      request: { method: req.method, url: req.originalUrl },
    });
    next();
  }
}
