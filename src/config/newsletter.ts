import type { UserRole } from '../types';

/**
 * Configuración del módulo de newsletter / campañas de email.
 *
 * Roles: fuente única de quién gestiona la newsletter en el panel. Cuando se
 * cree el rol "marketing" alcanza con sumarlo acá (y en el espejo del frontend,
 * `NEWSLETTER_ROLES` en `frontIndians/src/api/newsletter.ts`).
 *
 * `designer` entra a propósito pese a BR-ORDER-008 (no ve precios/costos): los
 * precios que muestra el bloque de productos son los PÚBLICOS de la tienda, los
 * mismos que ve cualquier visitante — nunca costos ni precio mayorista.
 */
export const NEWSLETTER_ROLES: UserRole[] = ['admin', 'billing', 'designer'];

/** Remitente de las campañas. Conviene un subdominio propio (ver 06-API). */
export function newsletterFrom(): string {
  return (
    process.env.NEWSLETTER_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    'noreply@indians.com.ar'
  );
}

export function newsletterReplyTo(): string | undefined {
  return process.env.NEWSLETTER_REPLY_TO || undefined;
}

/** Máximo de mails por llamada al batch de Resend (límite de la API: 100). */
export const NEWSLETTER_BATCH_SIZE = 100;

/**
 * Tope de mails por corrida del job (corre cada minuto). Sirve para no agotar
 * de golpe la cuota diaria/mensual del plan de Resend ni su rate limit.
 * Configurable por `NEWSLETTER_MAX_PER_RUN`.
 */
export function newsletterMaxPerRun(): number {
  const n = Number(process.env.NEWSLETTER_MAX_PER_RUN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

/** Pausa entre llamadas al batch (respeta el rate limit por segundo de Resend). */
export const NEWSLETTER_BATCH_PAUSE_MS = 600;

/** Vigencia del link de confirmación (doble opt-in). */
export const NEWSLETTER_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Antirrebote del mail de confirmación: si alguien carga la misma dirección
 * varias veces (o un tercero la usa para "bombardear" una casilla ajena), no se
 * reenvía la confirmación más de una vez por este intervalo.
 */
export const NEWSLETTER_CONFIRM_RESEND_MS = 10 * 60 * 1000;

/** Setting que marca que la importación única de clientes ya se hizo. */
export const NEWSLETTER_IMPORT_SETTING_KEY = 'newsletter_customers_imported_at';

/** Estados de pedido de tienda que cuentan como "compró" (mismo criterio que analytics). */
export const NEWSLETTER_PAID_STATUSES = ['paid', 'processing', 'shipped', 'delivered'];
