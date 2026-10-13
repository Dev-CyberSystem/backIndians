import { Op } from 'sequelize';
import { Resend } from 'resend';
import {
  NewsletterCampaign,
  NewsletterCampaignRecipient,
  NewsletterSubscriber,
} from '../models';
import { logger } from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { guardedSend, mailBlockedReason } from '../utils/mailGuard';
import { personalizeNewsletter } from '../utils/newsletterRender';
import {
  NEWSLETTER_BATCH_PAUSE_MS,
  NEWSLETTER_BATCH_SIZE,
  newsletterFrom,
  newsletterMaxPerRun,
  newsletterReplyTo,
} from '../config/newsletter';
import { oneClickUnsubscribeUrl, startSending, unsubscribePageUrl } from './newsletter.service';

/**
 * Envío de campañas por lotes + eventos del webhook de Resend.
 *
 * ─── Por qué un job y no la cola en memoria (`emailQueue.ts`) ──────────────
 * Una campaña son cientos o miles de mails: si el proceso se reinicia a mitad
 * (deploy en Railway), la cola en memoria se pierde. Acá el estado vive en la
 * base (`newsletter_campaign_recipients.status = 'queued'`) y el job retoma
 * donde quedó. Cada lote va con una Idempotency-Key derivada de las filas, así
 * que si el proceso muere justo después de que Resend aceptó el lote pero antes
 * de marcarlo en la base, el reintento no duplica los mails (Resend recuerda la
 * clave 24 h).
 *
 * ─── Requisitos de Gmail/Yahoo para envíos masivos ─────────────────────────
 * Cada mail lleva `List-Unsubscribe` + `List-Unsubscribe-Post` (baja en un clic,
 * RFC 8058) además del link visible en el pie.
 */

let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/** Solo para tests: permite inyectar un cliente falso. */
export function __setResendClientForTests(fake: unknown): void {
  client = fake as Resend;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errores de Resend que no son del lote sino del momento: se reintenta en la próxima corrida. */
const RETRYABLE = new Set([
  'rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded',
  'application_error', 'internal_server_error', 'concurrent_idempotent_requests',
]);

let running = false;

export interface ProcessResult {
  started: number;
  sent: number;
  skipped: number;
  failed: number;
  finished: number;
  paused?: string;
}

/**
 * Una corrida del job: arranca las campañas programadas que vencieron y
 * despacha hasta `NEWSLETTER_MAX_PER_RUN` mails de las que están en envío.
 */
export async function processNewsletterQueue(): Promise<ProcessResult> {
  const result: ProcessResult = { started: 0, sent: 0, skipped: 0, failed: 0, finished: 0 };
  if (running) return result;
  running = true;
  try {
    const due = await NewsletterCampaign.findAll({
      where: { status: 'scheduled', scheduled_at: { [Op.lte]: new Date() } },
      attributes: ['id'],
    });
    for (const c of due) {
      if (await startSending(c.id)) result.started++;
    }

    let budget = newsletterMaxPerRun();
    const sending = await NewsletterCampaign.findAll({
      where: { status: 'sending' },
      order: [['started_at', 'ASC'], ['id', 'ASC']],
    });

    for (const campaign of sending) {
      while (budget > 0) {
        const batch = await NewsletterCampaignRecipient.findAll({
          where: { campaign_id: campaign.id, status: 'queued' },
          order: [['id', 'ASC']],
          limit: Math.min(NEWSLETTER_BATCH_SIZE, budget),
        });

        if (batch.length === 0) {
          const [affected] = await NewsletterCampaign.update(
            { status: 'sent', finished_at: new Date() },
            { where: { id: campaign.id, status: 'sending' } }
          );
          if (affected) {
            result.finished++;
            logger.info('newsletter.campaign.finished', { meta: { campaignId: campaign.id } });
          }
          break;
        }

        const outcome = await sendBatch(campaign, batch);
        result.sent += outcome.sent;
        result.skipped += outcome.skipped;
        result.failed += outcome.failed;
        budget -= batch.length;

        if (outcome.paused) {
          result.paused = outcome.paused;
          return result;
        }
        await sleep(NEWSLETTER_BATCH_PAUSE_MS);
      }
      if (budget <= 0) break;
    }
    return result;
  } finally {
    running = false;
  }
}

async function sendBatch(
  campaign: NewsletterCampaign,
  batch: NewsletterCampaignRecipient[]
): Promise<{ sent: number; skipped: number; failed: number; paused?: string }> {
  const out = { sent: 0, skipped: 0, failed: 0 } as { sent: number; skipped: number; failed: number; paused?: string };

  // Se relee el estado del suscriptor: alguien pudo darse de baja (o rebotar en
  // otra campaña) desde que se armó la lista.
  const subs = await NewsletterSubscriber.findAll({
    where: { id: batch.map((r) => r.subscriber_id) },
    attributes: ['id', 'status', 'unsubscribe_token'],
  });
  const byId = new Map(subs.map((s) => [s.id, s]));

  const deliverable: Array<{ row: NewsletterCampaignRecipient; token: string }> = [];
  for (const row of batch) {
    const sub = byId.get(row.subscriber_id);
    if (!sub || sub.status !== 'subscribed') {
      await row.update({ status: 'skipped', error: sub ? `Suscriptor en estado ${sub.status}` : 'Suscriptor eliminado' });
      out.skipped++;
      continue;
    }
    const blocked = mailBlockedReason(row.email);
    if (blocked) {
      await row.update({ status: 'skipped', error: `No enviado: ${blocked}`.slice(0, 500) });
      out.skipped++;
      continue;
    }
    deliverable.push({ row, token: sub.unsubscribe_token });
  }
  if (deliverable.length === 0) return out;

  const html = campaign.html_snapshot ?? '';
  const replyTo = newsletterReplyTo();
  const payload = deliverable.map(({ row, token }) => ({
    from: newsletterFrom(),
    to: row.email,
    subject: personalizeNewsletter(campaign.subject, { name: row.name }, { html: false }),
    html: personalizeNewsletter(html, { name: row.name, unsubscribeUrl: unsubscribePageUrl(token, campaign.id) }),
    ...(replyTo ? { replyTo } : {}),
    headers: {
      'List-Unsubscribe': `<${oneClickUnsubscribeUrl(token, campaign.id)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [
      { name: 'type', value: 'newsletter' },
      { name: 'campaign_id', value: String(campaign.id) },
    ],
  }));

  const first = deliverable[0].row.id;
  const last = deliverable[deliverable.length - 1].row.id;
  const idempotencyKey = `newsletter-${campaign.id}-${first}-${last}-${deliverable.length}`;

  let response: Awaited<ReturnType<Resend['batch']['send']>>;
  try {
    response = await resend().batch.send(payload, { idempotencyKey });
  } catch (err) {
    // Error de red: las filas siguen `queued` y se reintentan en la próxima corrida.
    logger.error('newsletter.batch.networkError', err, { meta: { campaignId: campaign.id } });
    out.paused = 'network';
    return out;
  }

  if (response.error) {
    const { name, message } = response.error;
    if (RETRYABLE.has(name)) {
      logger.warn('newsletter.batch.paused', { message, meta: { campaignId: campaign.id, reason: name } });
      if (name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded') {
        await sendAlert({
          key: `newsletter-quota-${name}`,
          severity: 'warning',
          title: 'Newsletter pausada: se agotó la cuota de Resend',
          detail: `La campaña #${campaign.id} quedó en pausa (${name}). Retoma sola cuando se renueve la cuota; si es seguido, hay que subir de plan en Resend o bajar NEWSLETTER_MAX_PER_RUN.`,
        });
      }
      out.paused = name;
      return out;
    }
    // Error del contenido del lote (validación, remitente inválido...): no tiene
    // sentido reintentar el mismo lote igual.
    logger.error('newsletter.batch.rejected', new Error(message), { meta: { campaignId: campaign.id, reason: name } });
    for (const { row } of deliverable) {
      await row.update({ status: 'failed', error: `${name}: ${message}`.slice(0, 500) });
      out.failed++;
    }
    return out;
  }

  const ids = response.data?.data ?? [];
  const now = new Date();
  for (let i = 0; i < deliverable.length; i++) {
    await deliverable[i].row.update({ status: 'sent', sent_at: now, resend_email_id: ids[i]?.id ?? null, error: null });
    out.sent++;
  }
  return out;
}

/** Envío de prueba desde el editor. Pasa por `mailGuard` como cualquier mail. */
export async function sendNewsletterTest(input: { to: string[]; subject: string; html: string }): Promise<void> {
  for (const to of input.to) {
    await guardedSend(to, input.subject, async () => {
      const { error } = await resend().emails.send({
        from: newsletterFrom(),
        to,
        subject: input.subject,
        html: input.html,
        tags: [{ name: 'type', value: 'newsletter_test' }],
      });
      if (error) throw new Error(`${error.name}: ${error.message}`);
    });
  }
}

// ─── Webhook de Resend ───────────────────────────────────────────────────────

export interface ResendWebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

/**
 * Verifica la firma (Svix) del webhook. Sin `RESEND_WEBHOOK_SECRET` el webhook
 * queda deshabilitado (mismo criterio que el de MercadoPago): nunca se procesa
 * un evento sin firmar.
 */
export function verifyResendWebhook(rawBody: string, headers: ResendWebhookHeaders): unknown | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return null;
  try {
    return resend().webhooks.verify({
      payload: rawBody,
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
      webhookSecret: secret,
    });
  } catch {
    return null;
  }
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { type?: string } };
};

/**
 * Aplica un evento de Resend a la fila del destinatario (y, para rebotes
 * permanentes y denuncias de spam, al suscriptor: no se le vuelve a mandar).
 * Idempotente: cada fecha se graba solo la primera vez.
 */
export async function handleResendEvent(event: ResendEvent): Promise<void> {
  const emailId = event?.data?.email_id;
  if (!emailId || !event.type) return;

  const row = await NewsletterCampaignRecipient.findOne({ where: { resend_email_id: emailId } });
  if (!row) return; // mail transaccional u otro: no es de una campaña.

  const at = event.created_at ? new Date(event.created_at) : new Date();
  const setOnce = async (field: 'delivered_at' | 'opened_at' | 'clicked_at' | 'bounced_at' | 'complained_at') => {
    if (!row[field]) await row.update({ [field]: at });
  };

  switch (event.type) {
    case 'email.delivered':
      await setOnce('delivered_at');
      break;
    case 'email.opened':
      await setOnce('opened_at');
      break;
    case 'email.clicked':
      await setOnce('clicked_at');
      if (!row.opened_at) await row.update({ opened_at: at }); // un clic implica apertura
      break;
    case 'email.bounced': {
      await setOnce('bounced_at');
      // Solo el rebote permanente bloquea la dirección; uno transitorio (casilla
      // llena) no.
      const permanent = (event.data?.bounce?.type ?? 'Permanent').toLowerCase() !== 'transient';
      if (permanent) {
        await NewsletterSubscriber.update(
          { status: 'bounced', unsubscribed_at: at, unsubscribe_reason: 'bounce' },
          { where: { id: row.subscriber_id, status: { [Op.in]: ['subscribed', 'pending'] } } }
        );
      }
      break;
    }
    case 'email.complained':
      await setOnce('complained_at');
      await NewsletterSubscriber.update(
        { status: 'complained', unsubscribed_at: at, unsubscribe_reason: 'complaint' },
        { where: { id: row.subscriber_id, status: { [Op.ne]: 'complained' } } }
      );
      break;
    default:
      break;
  }
}
