import crypto from 'crypto';
import { Op, QueryTypes, WhereOptions } from 'sequelize';
import { sequelize } from '../config/db';
import {
  NewsletterSubscriber,
  NewsletterCampaign,
  NewsletterCampaignRecipient,
  StoreCustomer,
  CatalogProduct,
  CatalogProductImage,
  Settings,
  User,
} from '../models';
import type {
  NewsletterSubscriberSource,
  NewsletterSubscriberStatus,
} from '../models/NewsletterSubscriber';
import type { NewsletterAudience, NewsletterCampaignStatus } from '../models/NewsletterCampaign';
import type { NewsletterRecipientStatus } from '../models/NewsletterCampaignRecipient';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../utils/logger';
import { enqueueEmail } from '../utils/emailQueue';
import { sendNewsletterConfirmationEmail } from '../utils/email.service';
import { mailBlockedReason } from '../utils/mailGuard';
import { LOGO_URL } from '../utils/mailer';
import { getAllSettings } from './settings.service';
import {
  NEWSLETTER_BLOCK_TYPES,
  NewsletterBlock,
  NewsletterBrand,
  NewsletterProductCard,
  personalizeNewsletter,
  renderNewsletterHtml,
  safeUrl,
  slugify,
} from '../utils/newsletterRender';
import {
  NEWSLETTER_CONFIRM_RESEND_MS,
  NEWSLETTER_CONFIRM_TTL_MS,
  NEWSLETTER_IMPORT_SETTING_KEY,
  NEWSLETTER_PAID_STATUSES,
} from '../config/newsletter';

/**
 * Newsletter: lista de suscriptores con constancia de consentimiento + campañas.
 * Ver docs/project-brain/02-FUNCTIONAL-MAP.md (módulo 15) y DEC-028.
 *
 * El envío en sí (job por lotes contra Resend) vive en `newsletterSender.service.ts`.
 */

const STORE_URL = () => process.env.STORE_URL || 'http://localhost:5173/tienda';
const BACKEND_URL = () => process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

function newToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function consentFields(meta: RequestMeta) {
  return {
    consent_ip: meta.ip?.slice(0, 64) ?? null,
    consent_user_agent: meta.userAgent?.slice(0, 255) ?? null,
  };
}

/** Estados en los que la dirección nunca vuelve a recibir mails. */
const BLOCKED_STATUSES: NewsletterSubscriberStatus[] = ['bounced', 'complained'];

/** `ju***@gmail.com` — para mostrar en la página de baja sin exponer la dirección. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(3, user.length - visible.length))}@${domain}`;
}

export function unsubscribePageUrl(token: string, campaignId?: number): string {
  const base = `${STORE_URL().replace(/\/$/, '')}/newsletter/baja/${token}`;
  return campaignId ? `${base}?c=${campaignId}` : base;
}

/** URL del one-click (RFC 8058): la llama el cliente de correo por POST, sin página. */
export function oneClickUnsubscribeUrl(token: string, campaignId?: number): string {
  const base = `${BACKEND_URL().replace(/\/$/, '')}/api/v1/store/newsletter/unsubscribe/${token}`;
  return campaignId ? `${base}?c=${campaignId}` : base;
}

function confirmUrl(token: string): string {
  return `${STORE_URL().replace(/\/$/, '')}/newsletter/confirmar?token=${token}`;
}

// ─── Suscripción pública ─────────────────────────────────────────────────────

export interface SubscribeInput {
  email: string;
  name?: string | null;
  source: NewsletterSubscriberSource;
  customerId?: number | null;
  /**
   * `true` cuando la dirección ya está verificada (comprador logueado con email
   * verificado): se suscribe directo, sin mail de confirmación.
   */
  verified?: boolean;
}

export type SubscribeOutcome = 'confirmation_sent' | 'subscribed' | 'already_subscribed' | 'ignored';

/**
 * Pide la suscripción de una dirección.
 *
 * El endpoint público SIEMPRE responde lo mismo sin importar el resultado
 * (no revela si una dirección ya está en la lista). El resultado detallado
 * existe para los tests y para el perfil del comprador logueado.
 */
export async function requestSubscription(input: SubscribeInput, meta: RequestMeta = {}): Promise<SubscribeOutcome> {
  const email = normalizeEmail(input.email);
  // Defensa en profundidad: las rutas ya validan el formato, pero un llamador
  // interno con el campo equivocado no debe poder dejar una fila sin dirección.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('Email inválido', 400);
  const name = input.name?.trim().slice(0, 200) || null;
  const now = new Date();

  let sub = await NewsletterSubscriber.findOne({ where: { email } });

  if (sub && BLOCKED_STATUSES.includes(sub.status)) {
    // Rebote o denuncia de spam: no se vuelve a mandar nada a esta dirección.
    logger.info('newsletter.subscribe.blocked', { meta: { subscriberId: sub.id, status: sub.status } });
    return 'ignored';
  }

  if (sub && sub.status === 'subscribed') {
    let changed = false;
    if (!sub.name && name) { sub.name = name; changed = true; }
    if (!sub.store_customer_id && input.customerId) { sub.store_customer_id = input.customerId; changed = true; }
    if (changed) await sub.save();
    return 'already_subscribed';
  }

  if (input.verified) {
    if (!sub) {
      sub = NewsletterSubscriber.build({ email, source: input.source, unsubscribe_token: newToken() });
    }
    sub.set({
      name: sub.name ?? name,
      store_customer_id: sub.store_customer_id ?? input.customerId ?? null,
      status: 'subscribed',
      subscribed_at: now,
      unsubscribed_at: null,
      unsubscribe_reason: null,
      confirm_token_hash: null,
      confirm_token_expires_at: null,
      ...consentFields(meta),
    });
    await sub.save();
    return 'subscribed';
  }

  // Doble opt-in. Antirrebote: no reenviar la confirmación en ráfaga.
  if (
    sub && sub.status === 'pending' && sub.confirmation_sent_at &&
    now.getTime() - sub.confirmation_sent_at.getTime() < NEWSLETTER_CONFIRM_RESEND_MS
  ) {
    return 'confirmation_sent';
  }

  const token = newToken();
  if (!sub) {
    sub = NewsletterSubscriber.build({ email, source: input.source, unsubscribe_token: newToken() });
  }
  sub.set({
    name: sub.name ?? name,
    store_customer_id: sub.store_customer_id ?? input.customerId ?? null,
    status: 'pending',
    confirm_token_hash: hashToken(token),
    confirm_token_expires_at: new Date(now.getTime() + NEWSLETTER_CONFIRM_TTL_MS),
    confirmation_sent_at: now,
    ...consentFields(meta),
  });
  await sub.save();

  const subName = sub.name;
  enqueueEmail(`newsletter-confirm:${sub.id}`, () =>
    sendNewsletterConfirmationEmail(email, subName, confirmUrl(token))
  );
  return 'confirmation_sent';
}

export async function confirmSubscription(token: string): Promise<{ email: string }> {
  const sub = await NewsletterSubscriber.findOne({ where: { confirm_token_hash: hashToken(String(token)) } });
  if (!sub) throw new AppError('El enlace de confirmación no es válido.', 400);

  // Un segundo clic en el mismo link no es un error.
  if (sub.status === 'subscribed') return { email: maskEmail(sub.email) };

  if (
    sub.status !== 'pending' ||
    (sub.confirm_token_expires_at && sub.confirm_token_expires_at.getTime() < Date.now())
  ) {
    throw new AppError('El enlace de confirmación venció. Volvé a suscribirte desde la tienda.', 400);
  }

  sub.status = 'subscribed';
  sub.subscribed_at = new Date();
  sub.unsubscribed_at = null;
  sub.unsubscribe_reason = null;
  await sub.save();
  return { email: maskEmail(sub.email) };
}

/**
 * Registro de cuenta con la casilla de novedades tildada: queda `pending` SIN
 * mail propio, porque el mail de verificación de la cuenta ya prueba que la
 * dirección es de quien se registra. Se activa en `onCustomerEmailVerified`.
 */
export async function registerOptIn(customerId: number, email: string, name: string, meta: RequestMeta = {}): Promise<void> {
  const normalized = normalizeEmail(email);
  let sub = await NewsletterSubscriber.findOne({ where: { email: normalized } });
  if (sub && (BLOCKED_STATUSES.includes(sub.status) || sub.status === 'subscribed')) {
    if (!sub.store_customer_id) { sub.store_customer_id = customerId; await sub.save(); }
    return;
  }
  if (!sub) {
    sub = NewsletterSubscriber.build({ email: normalized, source: 'register', unsubscribe_token: newToken() });
  }
  sub.set({
    name: sub.name ?? name,
    store_customer_id: customerId,
    status: 'pending',
    ...consentFields(meta),
  });
  await sub.save();
}

/** Hook de `storeVerifyEmailService`: activa la suscripción pendiente de esa dirección. */
export async function onCustomerEmailVerified(customerId: number, email: string): Promise<void> {
  const sub = await NewsletterSubscriber.findOne({ where: { email: normalizeEmail(email) } });
  if (!sub || sub.status !== 'pending') return;
  sub.set({
    status: 'subscribed',
    subscribed_at: new Date(),
    store_customer_id: sub.store_customer_id ?? customerId,
    confirm_token_hash: null,
    confirm_token_expires_at: null,
  });
  await sub.save();
}

// ─── Baja ────────────────────────────────────────────────────────────────────

export async function getUnsubscribeInfo(token: string): Promise<{ email: string; subscribed: boolean }> {
  const sub = await NewsletterSubscriber.findOne({ where: { unsubscribe_token: String(token) } });
  if (!sub) throw new AppError('El enlace de baja no es válido.', 404);
  return { email: maskEmail(sub.email), subscribed: sub.status === 'subscribed' || sub.status === 'pending' };
}

export type UnsubscribeReason = 'link' | 'one_click' | 'account' | 'admin';

async function markUnsubscribed(sub: NewsletterSubscriber, reason: UnsubscribeReason, campaignId?: number): Promise<void> {
  const now = new Date();
  if (sub.status === 'subscribed' || sub.status === 'pending') {
    sub.set({ status: 'unsubscribed', unsubscribed_at: now, unsubscribe_reason: reason });
    await sub.save();
  }
  if (campaignId && Number.isInteger(campaignId) && campaignId > 0) {
    await NewsletterCampaignRecipient.update(
      { unsubscribed_at: now },
      { where: { campaign_id: campaignId, subscriber_id: sub.id, unsubscribed_at: null } }
    );
  }
}

/**
 * Baja por token (link del mail o one-click RFC 8058). Idempotente: dar de baja
 * a alguien ya dado de baja responde OK. Un token inexistente → 404.
 */
export async function unsubscribeByToken(token: string, reason: 'link' | 'one_click', campaignId?: number): Promise<void> {
  const sub = await NewsletterSubscriber.findOne({ where: { unsubscribe_token: String(token) } });
  if (!sub) throw new AppError('El enlace de baja no es válido.', 404);
  await markUnsubscribed(sub, reason, campaignId);
  logger.info('newsletter.unsubscribed', { meta: { subscriberId: sub.id, reason, campaignId } });
}

// ─── Comprador logueado ("Mis datos") ────────────────────────────────────────

export async function getCustomerNewsletter(customerId: number) {
  const customer = await StoreCustomer.findByPk(customerId, { attributes: ['id', 'email'] });
  if (!customer) throw new AppError('Cliente no encontrado', 404);
  const sub = await NewsletterSubscriber.findOne({ where: { email: normalizeEmail(customer.email) } });
  return {
    status: (sub?.status ?? null) as NewsletterSubscriberStatus | null,
    subscribed: sub?.status === 'subscribed',
  };
}

export async function setCustomerNewsletter(customerId: number, subscribed: boolean, meta: RequestMeta = {}) {
  const customer = await StoreCustomer.findByPk(customerId);
  if (!customer) throw new AppError('Cliente no encontrado', 404);

  if (subscribed) {
    const outcome = await requestSubscription(
      {
        email: customer.email,
        name: customer.name,
        source: 'account',
        customerId: customer.id,
        verified: customer.email_verified,
      },
      meta
    );
    if (outcome === 'ignored') {
      throw new AppError(
        'No podemos enviar mails a esta dirección (fue rechazada por tu proveedor de correo). Escribinos si querés reactivarla.',
        409
      );
    }
  } else {
    const sub = await NewsletterSubscriber.findOne({ where: { email: normalizeEmail(customer.email) } });
    if (sub) await markUnsubscribed(sub, 'account');
  }
  return getCustomerNewsletter(customerId);
}

// ─── Panel: suscriptores ─────────────────────────────────────────────────────

export interface ListSubscribersFilters {
  search?: string;
  status?: NewsletterSubscriberStatus;
  source?: NewsletterSubscriberSource;
  page?: number;
  limit?: number;
}

function subscriberWhere(f: ListSubscribersFilters): WhereOptions {
  const where: Record<string | symbol, unknown> = {};
  if (f.status) where.status = f.status;
  if (f.source) where.source = f.source;
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    where[Op.or] = [{ email: { [Op.like]: q } }, { name: { [Op.like]: q } }];
  }
  return where as WhereOptions;
}

const SUBSCRIBER_PUBLIC_ATTRS = [
  'id', 'email', 'name', 'store_customer_id', 'status', 'source',
  'subscribed_at', 'unsubscribed_at', 'unsubscribe_reason', 'createdAt',
];

export async function listSubscribers(f: ListSubscribersFilters) {
  const page = Math.max(1, f.page ?? 1);
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  return NewsletterSubscriber.findAndCountAll({
    where: subscriberWhere(f),
    attributes: SUBSCRIBER_PUBLIC_ATTRS,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
}

export async function subscriberStats() {
  const rows = await NewsletterSubscriber.findAll({
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  }) as unknown as Array<{ status: NewsletterSubscriberStatus; count: string | number }>;
  const by: Record<NewsletterSubscriberStatus, number> = {
    pending: 0, subscribed: 0, unsubscribed: 0, bounced: 0, complained: 0,
  };
  for (const r of rows) by[r.status] = Number(r.count);
  const imported = await Settings.findByPk(NEWSLETTER_IMPORT_SETTING_KEY);
  return {
    by_status: by,
    total: Object.values(by).reduce((a, b) => a + b, 0),
    customers_imported_at: imported?.value ?? null,
  };
}

/**
 * Alta manual desde el panel (ej. alguien que pidió sumarse en el local). Se
 * registra quién la hizo. NO reactiva a quien se dio de baja: esa decisión es
 * solo del titular (puede volver a suscribirse él mismo desde la tienda).
 */
export async function addSubscriberManually(data: { email: string; name?: string | null }, userId?: number) {
  const email = normalizeEmail(data.email);
  const existing = await NewsletterSubscriber.findOne({ where: { email } });
  if (existing) {
    if (existing.status === 'subscribed') throw new AppError('Esa dirección ya está suscripta.', 409);
    if (existing.status === 'unsubscribed') {
      throw new AppError('Esa persona se dio de baja: solo puede volver a suscribirse ella misma desde la tienda.', 409);
    }
    if (BLOCKED_STATUSES.includes(existing.status)) {
      throw new AppError('Esa dirección rebotó o marcó un envío como spam: no se le pueden mandar campañas.', 409);
    }
  }
  const sub = existing ?? NewsletterSubscriber.build({ email, source: 'admin', unsubscribe_token: newToken() });
  sub.set({
    name: data.name?.trim() || sub.name || null,
    status: 'subscribed',
    subscribed_at: new Date(),
    consent_ip: null,
    consent_user_agent: userId ? `panel:user#${userId}` : 'panel',
  });
  await sub.save();
  logger.info('newsletter.subscriber.addedByAdmin', { meta: { subscriberId: sub.id, userId } });
  return sub;
}

export async function adminUnsubscribe(id: number) {
  const sub = await NewsletterSubscriber.findByPk(id);
  if (!sub) throw new AppError('Suscriptor no encontrado', 404);
  await markUnsubscribed(sub, 'admin');
  return sub;
}

/**
 * Borrado definitivo (derecho de supresión, Ley 25.326 art. 16). Borra también
 * las filas de envíos de esa dirección: después de esto no queda el email en
 * ninguna tabla de newsletter. Para una simple baja usar `adminUnsubscribe`.
 */
export async function deleteSubscriber(id: number): Promise<void> {
  const sub = await NewsletterSubscriber.findByPk(id);
  if (!sub) throw new AppError('Suscriptor no encontrado', 404);
  await sequelize.transaction(async (t) => {
    await NewsletterCampaignRecipient.destroy({ where: { subscriber_id: id }, transaction: t });
    await sub.destroy({ transaction: t });
  });
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutraliza fórmulas al abrir el CSV en Excel (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportSubscribersCsv(f: ListSubscribersFilters): Promise<string> {
  const rows = await NewsletterSubscriber.findAll({
    where: subscriberWhere(f),
    attributes: SUBSCRIBER_PUBLIC_ATTRS,
    order: [['createdAt', 'DESC']],
  });
  const header = ['email', 'nombre', 'estado', 'origen', 'suscripto_el', 'baja_el', 'motivo_baja', 'alta'];
  const lines = rows.map((r) =>
    [r.email, r.name, r.status, r.source, r.subscribed_at, r.unsubscribed_at, r.unsubscribe_reason, r.createdAt]
      .map(csvCell).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

/**
 * Importación ÚNICA de los clientes ya registrados (decisión del 2026-10-07,
 * ver DEC-028): se los suma como suscriptos sobre la base de la relación
 * comercial previa (Ley 25.326 art. 27), con baja en un clic en cada mail.
 *
 * Solo cuentas activas con email verificado (o alta con Google): una cuenta
 * nunca verificada puede tener la dirección mal escrita, y los rebotes dañan
 * la reputación del dominio. Se marca en `settings` para que no se pueda
 * repetir: a partir de este release, los nuevos clientes eligen con la casilla.
 */
export async function importExistingCustomers(userId?: number): Promise<{ imported: number; skipped: number }> {
  const marker = await Settings.findByPk(NEWSLETTER_IMPORT_SETTING_KEY);
  if (marker?.value) {
    throw new AppError(`Los clientes ya se importaron el ${marker.value}. La importación se hace una sola vez.`, 409);
  }

  const customers = await StoreCustomer.findAll({
    where: {
      active: true,
      [Op.or]: [{ email_verified: true }, { google_id: { [Op.ne]: null } }],
    },
    attributes: ['id', 'email', 'name'],
  });

  const existing = new Set(
    (await NewsletterSubscriber.findAll({ attributes: ['email'], raw: true })).map((s) => normalizeEmail(s.email))
  );

  const now = new Date();
  const toCreate: Array<{
    email: string; name: string | null; store_customer_id: number; status: 'subscribed';
    source: 'existing_customer'; unsubscribe_token: string; subscribed_at: Date; consent_user_agent: string;
  }> = [];
  let skipped = 0;
  for (const c of customers) {
    const email = normalizeEmail(c.email);
    // Ya en la lista (en cualquier estado: incluye a quien se dio de baja) o
    // dirección de prueba → no se toca.
    if (existing.has(email) || mailBlockedReason(email)?.startsWith('dominio de prueba')) {
      skipped++;
      continue;
    }
    existing.add(email);
    toCreate.push({
      email,
      name: c.name,
      store_customer_id: c.id,
      status: 'subscribed' as const,
      source: 'existing_customer' as const,
      unsubscribe_token: newToken(),
      subscribed_at: now,
      consent_user_agent: userId ? `importacion:user#${userId}` : 'importacion',
    });
  }

  await sequelize.transaction(async (t) => {
    for (let i = 0; i < toCreate.length; i += 500) {
      await NewsletterSubscriber.bulkCreate(toCreate.slice(i, i + 500), { transaction: t });
    }
    await Settings.upsert(
      { key: NEWSLETTER_IMPORT_SETTING_KEY, value: now.toISOString(), createdAt: now, updatedAt: now },
      { transaction: t }
    );
  });

  logger.info('newsletter.importCustomers', { meta: { imported: toCreate.length, skipped, userId } });
  return { imported: toCreate.length, skipped };
}

// ─── Segmentos ───────────────────────────────────────────────────────────────

export const AUDIENCE_LABELS: Record<NewsletterAudience, string> = {
  all: 'Todos los suscriptos',
  customers: 'Suscriptos con cuenta en la tienda',
  buyers: 'Suscriptos que ya compraron',
  non_buyers: 'Suscriptos que todavía no compraron',
};

/**
 * Suscriptos del segmento. Los cruces son por email (no por FK) para incluir
 * compras como invitado y cuentas creadas después de suscribirse.
 */
async function audienceSubscriberIds(audience: NewsletterAudience): Promise<Array<{ id: number; email: string; name: string | null }>> {
  const paid = `SELECT 1 FROM store_orders so WHERE LOWER(so.customer_email) = ns.email AND so.status IN (:paid)`;
  const conditions: Record<NewsletterAudience, string> = {
    all: '1=1',
    customers: 'EXISTS (SELECT 1 FROM store_customers sc WHERE LOWER(sc.email) = ns.email)',
    buyers: `EXISTS (${paid})`,
    non_buyers: `NOT EXISTS (${paid})`,
  };
  return sequelize.query<{ id: number; email: string; name: string | null }>(
    `SELECT ns.id, ns.email, ns.name FROM newsletter_subscribers ns
      WHERE ns.status = 'subscribed' AND ${conditions[audience]}
      ORDER BY ns.id ASC`,
    { replacements: { paid: NEWSLETTER_PAID_STATUSES }, type: QueryTypes.SELECT }
  );
}

export async function audienceCounts(): Promise<Record<NewsletterAudience, number>> {
  const keys = Object.keys(AUDIENCE_LABELS) as NewsletterAudience[];
  const out = {} as Record<NewsletterAudience, number>;
  for (const k of keys) out[k] = (await audienceSubscriberIds(k)).length;
  return out;
}

// ─── Campañas: validación de bloques ─────────────────────────────────────────

const MAX_BLOCKS = 40;

function str(v: unknown, max: number, field: string, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new AppError(`Falta completar ${field}`, 400);
  if (s.length > max) throw new AppError(`${field}: máximo ${max} caracteres`, 400);
  return s;
}

function url(v: unknown, field: string, required = true): string | undefined {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (!raw) {
    if (required) throw new AppError(`Falta completar ${field}`, 400);
    return undefined;
  }
  if (raw.length > 1000 || !safeUrl(raw)) throw new AppError(`${field}: el link tiene que empezar con https://`, 400);
  return raw;
}

const align = (v: unknown) => (v === 'center' ? 'center' : 'left') as 'left' | 'center';

/**
 * Valida y normaliza los bloques que manda el editor (no se confía en el cliente).
 * `lenient` (solo vista previa): un bloque a medio completar se omite en vez de
 * cortar todo el render — mientras se escribe, la vista previa no debe romperse.
 */
export function sanitizeBlocks(input: unknown, { lenient = false }: { lenient?: boolean } = {}): NewsletterBlock[] {
  if (!Array.isArray(input)) throw new AppError('El contenido de la newsletter es inválido', 400);
  if (input.length > MAX_BLOCKS) throw new AppError(`Máximo ${MAX_BLOCKS} bloques por newsletter`, 400);
  if (lenient) {
    return input.flatMap((raw) => {
      try { return sanitizeBlocks([raw]); } catch { return []; }
    });
  }

  return input.map((raw, i): NewsletterBlock => {
    const b = (raw ?? {}) as Record<string, unknown>;
    const n = `bloque ${i + 1}`;
    if (!NEWSLETTER_BLOCK_TYPES.includes(b.type as never)) throw new AppError(`Tipo de bloque inválido (${n})`, 400);
    switch (b.type) {
      case 'heading': return { type: 'heading', text: str(b.text, 200, `el título (${n})`), align: align(b.align) };
      case 'text': return { type: 'text', text: str(b.text, 5000, `el texto (${n})`), align: align(b.align) };
      case 'image':
        return {
          type: 'image',
          url: url(b.url, `la imagen (${n})`)!,
          alt: str(b.alt, 200, 'el texto alternativo', false) || undefined,
          link: url(b.link, `el link de la imagen (${n})`, false),
        };
      case 'button':
        return { type: 'button', label: str(b.label, 60, `el texto del botón (${n})`), url: url(b.url, `el link del botón (${n})`)!, align: align(b.align) };
      case 'products': {
        const ids = Array.isArray(b.product_ids) ? b.product_ids.map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
        if (ids.length === 0) throw new AppError(`Elegí al menos un producto (${n})`, 400);
        if (ids.length > 8) throw new AppError(`Máximo 8 productos por bloque (${n})`, 400);
        return { type: 'products', product_ids: [...new Set(ids)], title: str(b.title, 120, 'el título', false) || undefined };
      }
      case 'coupon':
        return { type: 'coupon', code: str(b.code, 64, `el código del cupón (${n})`), text: str(b.text, 200, 'el texto', false) || undefined };
      case 'divider': return { type: 'divider' };
      case 'spacer': return { type: 'spacer', size: b.size === 'sm' || b.size === 'lg' ? b.size : 'md' };
      default: throw new AppError(`Tipo de bloque inválido (${n})`, 400);
    }
  });
}

// ─── Campañas: render ────────────────────────────────────────────────────────

function socialUrl(v: string | undefined, base: string): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `${base}${s.replace(/^@/, '')}`;
}

async function loadBrand(): Promise<NewsletterBrand> {
  const s = await getAllSettings();
  return {
    storeName: s.store_name || 'Indians',
    logoUrl: s.store_logo_url || LOGO_URL,
    storeUrl: STORE_URL(),
    address: s.company_address || null,
    instagram: socialUrl(s.store_instagram, 'https://instagram.com/'),
    facebook: socialUrl(s.store_facebook, 'https://facebook.com/'),
  };
}

/**
 * Productos del bloque, con el precio PÚBLICO vigente (mismo criterio que la
 * tienda). Solo productos publicados: si uno se despublicó, desaparece del mail.
 */
async function loadProducts(blocks: NewsletterBlock[]): Promise<Map<number, NewsletterProductCard>> {
  const ids = [...new Set(blocks.flatMap((b) => (b.type === 'products' ? b.product_ids : [])))];
  const map = new Map<number, NewsletterProductCard>();
  if (ids.length === 0) return map;
  const products = await CatalogProduct.findAll({
    where: { id: ids, show_in_store: true, active: true },
    attributes: ['id', 'title', 'price', 'public_price', 'discount_percentage'],
    include: [{ model: CatalogProductImage, as: 'images', attributes: ['url', 'sort_order'] }],
  });
  for (const p of products) {
    const base = Number(p.public_price ?? p.price);
    const disc = Number(p.discount_percentage ?? 0);
    const price = disc > 0 ? parseFloat((base * (100 - disc) / 100).toFixed(2)) : base;
    const images = ((p as unknown as { images?: Array<{ url: string; sort_order: number }> }).images ?? [])
      .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    map.set(p.id, {
      id: p.id,
      title: p.title,
      price,
      original_price: disc > 0 ? base : null,
      image: images[0]?.url ?? null,
    });
  }
  return map;
}

export interface CampaignContent {
  subject: string;
  preheader?: string | null;
  blocks: NewsletterBlock[];
  name?: string;
}

export async function renderCampaign(content: CampaignContent): Promise<string> {
  const [brand, products] = await Promise.all([loadBrand(), loadProducts(content.blocks)]);
  return renderNewsletterHtml({
    subject: content.subject,
    preheader: content.preheader,
    blocks: content.blocks,
    products,
    brand,
    campaignSlug: slugify(content.name || content.subject),
  });
}

/** Vista previa del editor (contenido sin guardar). */
export async function previewCampaign(input: { subject?: string; preheader?: string; blocks: unknown; name?: string }, previewName?: string) {
  const blocks = sanitizeBlocks(input.blocks, { lenient: true });
  const subject = (input.subject ?? '').trim() || '(sin asunto)';
  const html = await renderCampaign({ subject, preheader: input.preheader, blocks, name: input.name });
  return {
    subject: personalizeNewsletter(subject, { name: previewName }, { html: false }),
    html: personalizeNewsletter(html, { name: previewName, unsubscribeUrl: '#' }),
  };
}

// ─── Campañas: ABM ───────────────────────────────────────────────────────────

const AUDIENCES: NewsletterAudience[] = ['all', 'customers', 'buyers', 'non_buyers'];

export interface CampaignInput {
  name?: string;
  subject?: string;
  preheader?: string | null;
  blocks?: unknown;
  audience?: NewsletterAudience;
}

function campaignFields(data: CampaignInput, partial: boolean) {
  const out: Partial<{ name: string; subject: string; preheader: string | null; blocks: NewsletterBlock[]; audience: NewsletterAudience }> = {};
  if (!partial || data.name !== undefined) out.name = str(data.name, 150, 'el nombre interno');
  if (!partial || data.subject !== undefined) out.subject = str(data.subject, 200, 'el asunto');
  if (data.preheader !== undefined) out.preheader = str(data.preheader, 200, 'el preheader', false) || null;
  if (!partial || data.blocks !== undefined) out.blocks = sanitizeBlocks(data.blocks ?? []);
  if (data.audience !== undefined) {
    if (!AUDIENCES.includes(data.audience)) throw new AppError('Segmento inválido', 400);
    out.audience = data.audience;
  }
  return out;
}

type CampaignStats = {
  queued: number; sent: number; failed: number; skipped: number;
  delivered: number; opened: number; clicked: number; bounced: number; complained: number; unsubscribed: number;
};

async function statsFor(ids: number[]): Promise<Map<number, CampaignStats>> {
  const map = new Map<number, CampaignStats>();
  if (ids.length === 0) return map;
  const rows = await sequelize.query<Record<string, string | number>>(
    `SELECT campaign_id,
            SUM(status = 'queued') AS queued,
            SUM(status = 'sent') AS sent,
            SUM(status = 'failed') AS failed,
            SUM(status = 'skipped') AS skipped,
            SUM(delivered_at IS NOT NULL) AS delivered,
            SUM(opened_at IS NOT NULL) AS opened,
            SUM(clicked_at IS NOT NULL) AS clicked,
            SUM(bounced_at IS NOT NULL) AS bounced,
            SUM(complained_at IS NOT NULL) AS complained,
            SUM(unsubscribed_at IS NOT NULL) AS unsubscribed
       FROM newsletter_campaign_recipients
      WHERE campaign_id IN (:ids)
      GROUP BY campaign_id`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  for (const r of rows) {
    map.set(Number(r.campaign_id), {
      queued: Number(r.queued), sent: Number(r.sent), failed: Number(r.failed), skipped: Number(r.skipped),
      delivered: Number(r.delivered), opened: Number(r.opened), clicked: Number(r.clicked),
      bounced: Number(r.bounced), complained: Number(r.complained), unsubscribed: Number(r.unsubscribed),
    });
  }
  return map;
}

const EMPTY_STATS: CampaignStats = {
  queued: 0, sent: 0, failed: 0, skipped: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0,
};

function serializeCampaign(c: NewsletterCampaign, stats?: CampaignStats, withContent = false) {
  const json = c.toJSON() as Record<string, unknown>;
  delete json.html_snapshot;
  if (!withContent) delete json.blocks;
  return { ...json, blocks: withContent ? c.blocks : undefined, stats: stats ?? EMPTY_STATS };
}

export async function listCampaigns(f: { status?: NewsletterCampaignStatus; page?: number; limit?: number }) {
  const page = Math.max(1, f.page ?? 1);
  const limit = Math.min(100, Math.max(1, f.limit ?? 20));
  const { rows, count } = await NewsletterCampaign.findAndCountAll({
    where: f.status ? { status: f.status } : {},
    attributes: { exclude: ['html_snapshot'] },
    include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  const stats = await statsFor(rows.map((r) => r.id));
  return { rows: rows.map((r) => serializeCampaign(r, stats.get(r.id))), count };
}

async function findCampaign(id: number): Promise<NewsletterCampaign> {
  const c = await NewsletterCampaign.findByPk(id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
  });
  if (!c) throw new AppError('Campaña no encontrada', 404);
  return c;
}

export async function getCampaign(id: number) {
  const c = await findCampaign(id);
  const stats = await statsFor([id]);
  return serializeCampaign(c, stats.get(id), true);
}

export async function createCampaign(data: CampaignInput, userId?: number) {
  const fields = campaignFields(data, false);
  const c = await NewsletterCampaign.create({
    name: fields.name!,
    subject: fields.subject!,
    preheader: fields.preheader ?? null,
    blocks: fields.blocks!,
    audience: fields.audience ?? 'all',
    created_by_user_id: userId ?? null,
    updated_by_user_id: userId ?? null,
  });
  return getCampaign(c.id);
}

function assertEditable(c: NewsletterCampaign) {
  if (c.status !== 'draft') {
    throw new AppError('Solo se puede editar una campaña en borrador. Si está programada, desprogramala primero.', 409);
  }
}

export async function updateCampaign(id: number, data: CampaignInput, userId?: number) {
  const c = await findCampaign(id);
  assertEditable(c);
  c.set({ ...campaignFields(data, true), updated_by_user_id: userId ?? null });
  await c.save();
  return getCampaign(id);
}

export async function deleteCampaign(id: number) {
  const c = await findCampaign(id);
  if (c.status !== 'draft') {
    throw new AppError('Solo se puede borrar un borrador. Las campañas enviadas quedan como historial.', 409);
  }
  await c.destroy();
}

export async function duplicateCampaign(id: number, userId?: number) {
  const c = await findCampaign(id);
  const copy = await NewsletterCampaign.create({
    name: `${c.name} (copia)`.slice(0, 150),
    subject: c.subject,
    preheader: c.preheader,
    blocks: c.blocks,
    audience: c.audience,
    created_by_user_id: userId ?? null,
    updated_by_user_id: userId ?? null,
  });
  return getCampaign(copy.id);
}

export async function listRecipients(
  campaignId: number,
  f: { status?: NewsletterRecipientStatus; page?: number; limit?: number }
) {
  await findCampaign(campaignId);
  const page = Math.max(1, f.page ?? 1);
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  return NewsletterCampaignRecipient.findAndCountAll({
    where: { campaign_id: campaignId, ...(f.status ? { status: f.status } : {}) },
    attributes: [
      'id', 'email', 'name', 'status', 'error', 'sent_at', 'delivered_at', 'opened_at',
      'clicked_at', 'bounced_at', 'complained_at', 'unsubscribed_at',
    ],
    order: [['id', 'ASC']],
    limit,
    offset: (page - 1) * limit,
  });
}

// ─── Campañas: programar / enviar / cancelar ─────────────────────────────────

/**
 * Confirma el envío. Sin fecha (o con fecha pasada) arranca ya; con fecha
 * futura queda `scheduled` y la toma el job. La lista de destinatarios y el
 * HTML se congelan recién al ARRANCAR (no al programar), así se respetan las
 * bajas que lleguen mientras tanto y los precios salen actualizados.
 */
export async function scheduleCampaign(id: number, scheduledAt: Date | null, userId?: number) {
  const c = await findCampaign(id);
  assertEditable(c);
  if (c.blocks.length === 0) throw new AppError('La newsletter está vacía: agregá al menos un bloque.', 400);

  const audience = await audienceSubscriberIds(c.audience);
  if (audience.length === 0) throw new AppError('El segmento elegido no tiene suscriptos.', 400);

  if (scheduledAt && scheduledAt.getTime() > Date.now() + 60_000) {
    c.set({ status: 'scheduled', scheduled_at: scheduledAt, sent_by_user_id: userId ?? null });
    await c.save();
    return getCampaign(id);
  }

  c.set({ sent_by_user_id: userId ?? null });
  await c.save();
  await startSending(c.id);
  return getCampaign(id);
}

/** Vuelve una campaña programada a borrador (antes de que arranque). */
export async function unscheduleCampaign(id: number) {
  const [affected] = await NewsletterCampaign.update(
    { status: 'draft', scheduled_at: null },
    { where: { id, status: 'scheduled' } }
  );
  if (affected === 0) throw new AppError('La campaña no está programada (puede que ya haya empezado a enviarse).', 409);
  return getCampaign(id);
}

/**
 * Pasa la campaña a `sending`: congela el HTML y crea las filas de
 * destinatarios. El UPDATE condicional (`status IN draft/scheduled`) es la
 * guarda contra un doble arranque (doble clic, o el job y un clic a la vez).
 */
export async function startSending(id: number): Promise<boolean> {
  const c = await NewsletterCampaign.findByPk(id);
  if (!c) return false;
  const html = await renderCampaign({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, name: c.name });

  return sequelize.transaction(async (t) => {
    const [affected] = await NewsletterCampaign.update(
      { status: 'sending', started_at: new Date(), html_snapshot: html },
      { where: { id, status: { [Op.in]: ['draft', 'scheduled'] } }, transaction: t }
    );
    if (affected === 0) return false;

    const audience = await audienceSubscriberIds(c.audience);
    const rows = audience.map((s) => ({ campaign_id: id, subscriber_id: s.id, email: s.email, name: s.name }));
    for (let i = 0; i < rows.length; i += 1000) {
      await NewsletterCampaignRecipient.bulkCreate(rows.slice(i, i + 1000), { transaction: t });
    }
    await NewsletterCampaign.update({ total_recipients: rows.length }, { where: { id }, transaction: t });
    logger.info('newsletter.campaign.started', { meta: { campaignId: id, recipients: rows.length } });
    return true;
  });
}

/** Corta un envío en curso: lo que no salió queda `skipped`. */
export async function cancelCampaign(id: number) {
  const c = await findCampaign(id);
  if (c.status === 'scheduled') return unscheduleCampaign(id);
  if (c.status !== 'sending') throw new AppError('Solo se puede cancelar una campaña programada o en envío.', 409);
  await sequelize.transaction(async (t) => {
    await NewsletterCampaign.update({ status: 'cancelled', finished_at: new Date() }, { where: { id, status: 'sending' }, transaction: t });
    await NewsletterCampaignRecipient.update(
      { status: 'skipped', error: 'Envío cancelado' },
      { where: { campaign_id: id, status: 'queued' }, transaction: t }
    );
  });
  return getCampaign(id);
}

/** Envío de prueba a hasta 5 direcciones (no cuenta como envío de la campaña). */
export async function sendTestEmail(id: number, emails: string[], testerName?: string) {
  const c = await findCampaign(id);
  const html = await renderCampaign({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, name: c.name });
  const { sendNewsletterTest } = await import('./newsletterSender.service');
  const to = [...new Set(emails.map(normalizeEmail))].slice(0, 5);
  await sendNewsletterTest({
    to,
    subject: `[PRUEBA] ${personalizeNewsletter(c.subject, { name: testerName }, { html: false })}`,
    html: personalizeNewsletter(html, { name: testerName, unsubscribeUrl: '#' }),
  });
  return { sent_to: to };
}

/**
 * Casilla "Quiero recibir novedades" del checkout. Directo si el comprador está
 * logueado, con el email de su cuenta y verificado; si no, doble opt-in.
 * Nunca tira: una suscripción que falla no puede voltear una compra.
 */
export async function checkoutOptIn(
  input: { email: string; name?: string | null; customerId?: number | null },
  meta: RequestMeta = {}
): Promise<void> {
  try {
    let verified = false;
    if (input.customerId) {
      const customer = await StoreCustomer.findByPk(input.customerId, { attributes: ['id', 'email', 'email_verified'] });
      verified = !!customer?.email_verified && normalizeEmail(customer.email) === normalizeEmail(input.email);
    }
    await requestSubscription(
      { email: input.email, name: input.name, source: 'checkout', customerId: input.customerId ?? null, verified },
      meta
    );
  } catch (err) {
    logger.error('newsletter.checkoutOptIn.failed', err, { meta: { customerId: input.customerId } });
  }
}
