import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../config/db';
import { NewsletterSubscriber, Settings, StoreCoupon } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { enqueueEmail } from '../utils/emailQueue';
import { sendWelcomeCouponEmail } from '../utils/email.service';
import { invalidateCache } from '../utils/cache';
import { logger } from '../utils/logger';
import {
  WELCOME_SETTING_KEYS, parseWelcomeConfig, generateWelcomeCode, normalizeSubscriberEmail,
  welcomeExpiry, canResendCoupon, type WelcomeConfig,
} from '../utils/welcomeCoupon';
import { welcomePopupOptIn, type RequestMeta } from './newsletter.service';

/**
 * Pop-up de registro con descuento (brief 06.10.2026, pedido 03).
 *
 * El visitante deja email (+ nombre opcional) y recibe un cupón PERSONAL de un
 * solo uso (`max_uses = 1`, vence a los N días), creado como una fila de
 * `store_coupons`. El checkout lo valida con la misma lógica de siempre
 * (`validateCoupon`): se aplica sobre el subtotal ya con los descuentos de
 * producto, y como el pedido admite un único cupón, no se acumula con otros.
 *
 * Quién ve el código: solo quien se registra por primera vez lo ve en pantalla.
 * Si el email ya estaba registrado NO se devuelve el código (cualquiera podría
 * tipear el email de otra persona y quedarse con su cupón): se reenvía por mail.
 *
 * No hay tabla propia de registros: la persona queda en `newsletter_subscribers`
 * (origen `welcome_popup`) con su cupón en `welcome_coupon_id`. La suscripción a
 * las campañas queda pendiente hasta que confirme desde el mail del cupón
 * (`welcomePopupOptIn`). El panel la ve en Newsletter → Suscriptores.
 */

export async function getWelcomeConfig(): Promise<WelcomeConfig> {
  const rows = await Settings.findAll({ where: { key: [...WELCOME_SETTING_KEYS] } });
  return parseWelcomeConfig(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])));
}

export type SubscribeResult =
  | { status: 'created'; code: string; discount_percent: number; expires_at: Date }
  | { status: 'already_registered' };

const MAX_CODE_ATTEMPTS = 5;

export async function subscribeWelcome(
  input: { email: string; name?: string | null },
  meta: RequestMeta = {},
): Promise<SubscribeResult> {
  const config = await getWelcomeConfig();
  if (!config.enabled) throw new AppError('Este beneficio no está disponible por el momento', 404);

  const email = normalizeSubscriberEmail(input.email);
  const name = input.name?.trim() ? input.name.trim().slice(0, 100) : null;

  // Un cupón por dirección. Estar ya en la lista (por el pie de la tienda, el
  // registro o el checkout) NO impide recibirlo: solo lo impide haberlo recibido.
  const existing = await NewsletterSubscriber.findOne({ where: { email } });
  if (existing?.welcome_coupon_id) {
    await resendExistingCoupon(existing);
    return { status: 'already_registered' };
  }

  const now = new Date();
  const expiresAt = welcomeExpiry(now, config.validDays);

  try {
    const { coupon, confirmUrl } = await sequelize.transaction(async (t) => {
      // El código es aleatorio: en el caso (remoto) de choque con uno existente se reintenta.
      let created: StoreCoupon | null = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !created; attempt++) {
        const code = generateWelcomeCode();
        if (await StoreCoupon.findOne({ where: { code }, transaction: t })) continue;
        created = await StoreCoupon.create({
          code,
          description: `Bienvenida ${email}`,
          type: 'percentage',
          value: config.percent,
          max_uses: 1,
          active: true,
          show_popup: false,
          expires_at: expiresAt,
        }, { transaction: t });
      }
      if (!created) throw new AppError('No pudimos generar tu cupón. Probá de nuevo en unos minutos.', 503);

      const optIn = await welcomePopupOptIn({ email, name }, meta, t);
      await optIn.subscriber.update({ welcome_coupon_id: created.id, welcome_coupon_sent_at: now }, { transaction: t });
      return { coupon: created, confirmUrl: optIn.confirmUrl };
    });

    queueCouponEmail(email, name, coupon.code, config.percent, expiresAt, confirmUrl);
    return { status: 'created', code: coupon.code, discount_percent: config.percent, expires_at: expiresAt };
  } catch (err) {
    // Dos envíos simultáneos del mismo email: el segundo choca con la restricción única.
    if (err instanceof UniqueConstraintError) return { status: 'already_registered' };
    throw err;
  }
}

/** Si el email ya estaba registrado y su cupón sigue vigente, se le reenvía el mail (con enfriamiento). */
async function resendExistingCoupon(subscriber: NewsletterSubscriber): Promise<void> {
  if (!subscriber.welcome_coupon_id || !canResendCoupon(subscriber.welcome_coupon_sent_at)) return;
  const coupon = await StoreCoupon.findByPk(subscriber.welcome_coupon_id);
  if (!coupon || !coupon.active) return;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return;
  if (coupon.expires_at && coupon.expires_at.getTime() < Date.now()) return;

  await subscriber.update({ welcome_coupon_sent_at: new Date() });
  queueCouponEmail(subscriber.email, subscriber.name, coupon.code, Number(coupon.value), coupon.expires_at);
}

function queueCouponEmail(
  email: string, name: string | null | undefined, code: string, percent: number, expiresAt: Date | null,
  confirmUrl: string | null = null,
) {
  enqueueEmail('welcomeCoupon', () =>
    sendWelcomeCouponEmail({ email, name, code, percent, expiresAt, confirmUrl })
  );
  logger.info('storeSubscriber.couponQueued', { meta: { fatal: false } });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

/** Los cupones de bienvenida (uno por persona) no se mezclan con los que carga el admin a mano. */
export const WELCOME_COUPON_EXCLUSION = sequelize.literal(
  '(SELECT welcome_coupon_id FROM newsletter_subscribers WHERE welcome_coupon_id IS NOT NULL)'
);

/** Para invalidar la caché pública cuando el admin cambia la configuración del pop-up. */
export function invalidateWelcomePublicCache(): void {
  invalidateCache('store:settings');
}
