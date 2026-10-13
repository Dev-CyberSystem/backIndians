import { Op, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../config/db';
import { Settings, StoreCoupon, StoreSubscriber } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { enqueueEmail } from '../utils/emailQueue';
import { sendWelcomeCouponEmail } from '../utils/email.service';
import { invalidateCache } from '../utils/cache';
import { logger } from '../utils/logger';
import {
  WELCOME_SETTING_KEYS, parseWelcomeConfig, generateWelcomeCode, normalizeSubscriberEmail,
  welcomeExpiry, canResendCoupon, toCsv, type WelcomeConfig,
} from '../utils/welcomeCoupon';

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
 */

export async function getWelcomeConfig(): Promise<WelcomeConfig> {
  const rows = await Settings.findAll({ where: { key: [...WELCOME_SETTING_KEYS] } });
  return parseWelcomeConfig(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])));
}

export type SubscribeResult =
  | { status: 'created'; code: string; discount_percent: number; expires_at: Date }
  | { status: 'already_registered' };

const MAX_CODE_ATTEMPTS = 5;

export async function subscribeWelcome(input: { email: string; name?: string | null }): Promise<SubscribeResult> {
  const config = await getWelcomeConfig();
  if (!config.enabled) throw new AppError('Este beneficio no está disponible por el momento', 404);

  const email = normalizeSubscriberEmail(input.email);
  const name = input.name?.trim() ? input.name.trim().slice(0, 100) : null;

  const existing = await StoreSubscriber.findOne({ where: { email } });
  if (existing) {
    await resendExistingCoupon(existing);
    return { status: 'already_registered' };
  }

  const now = new Date();
  const expiresAt = welcomeExpiry(now, config.validDays);

  try {
    const coupon = await sequelize.transaction(async (t) => {
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

      await StoreSubscriber.create({
        email, name, coupon_id: created.id, source: 'welcome_popup', consent_at: now, coupon_sent_at: now,
      }, { transaction: t });
      return created;
    });

    queueCouponEmail(email, name, coupon.code, config.percent, expiresAt);
    return { status: 'created', code: coupon.code, discount_percent: config.percent, expires_at: expiresAt };
  } catch (err) {
    // Dos envíos simultáneos del mismo email: el segundo choca con la restricción única.
    if (err instanceof UniqueConstraintError) return { status: 'already_registered' };
    throw err;
  }
}

/** Si el email ya estaba registrado y su cupón sigue vigente, se le reenvía el mail (con enfriamiento). */
async function resendExistingCoupon(subscriber: StoreSubscriber): Promise<void> {
  if (!subscriber.coupon_id || !canResendCoupon(subscriber.coupon_sent_at)) return;
  const coupon = await StoreCoupon.findByPk(subscriber.coupon_id);
  if (!coupon || !coupon.active) return;
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return;
  if (coupon.expires_at && coupon.expires_at.getTime() < Date.now()) return;

  await subscriber.update({ coupon_sent_at: new Date() });
  queueCouponEmail(subscriber.email, subscriber.name, coupon.code, Number(coupon.value), coupon.expires_at);
}

function queueCouponEmail(email: string, name: string | null | undefined, code: string, percent: number, expiresAt: Date | null) {
  enqueueEmail('welcomeCoupon', () =>
    sendWelcomeCouponEmail({ email, name, code, percent, expiresAt })
  );
  logger.info('storeSubscriber.couponQueued', { meta: { fatal: false } });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

/** Los cupones de bienvenida (uno por persona) no se mezclan con los que carga el admin a mano. */
export const WELCOME_COUPON_EXCLUSION = sequelize.literal(
  '(SELECT coupon_id FROM store_subscribers WHERE coupon_id IS NOT NULL)'
);

export async function listSubscribers(opts: { search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 25), 100);
  const where = opts.search
    ? { [Op.or]: [{ email: { [Op.like]: `%${opts.search}%` } }, { name: { [Op.like]: `%${opts.search}%` } }] }
    : {};

  const { count, rows } = await StoreSubscriber.findAndCountAll({
    where,
    include: [{ model: StoreCoupon, as: 'coupon', attributes: ['code', 'used_count', 'max_uses', 'expires_at', 'active'], required: false }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows, meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) } };
}

export async function exportSubscribersCsv(): Promise<string> {
  const rows = await StoreSubscriber.findAll({
    include: [{ model: StoreCoupon, as: 'coupon', attributes: ['code', 'used_count', 'expires_at'], required: false }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });
  const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : '');
  return toCsv(
    ['email', 'nombre', 'registrado', 'cupon', 'cupon_usado', 'cupon_vence'],
    rows.map((r) => {
      const c = (r as StoreSubscriber & { coupon?: StoreCoupon | null }).coupon;
      return [r.email, r.name, iso(r.createdAt), c?.code, c ? (c.used_count > 0 ? 'si' : 'no') : '', iso(c?.expires_at)];
    })
  );
}

/** Para invalidar la caché pública cuando el admin cambia la configuración del pop-up. */
export function invalidateWelcomePublicCache(): void {
  invalidateCache('store:settings');
}
