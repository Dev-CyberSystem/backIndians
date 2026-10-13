import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as newsletter from '../services/newsletter.service';
import { handleResendEvent, verifyResendWebhook } from '../services/newsletterSender.service';
import { logger } from '../utils/logger';
import type { NewsletterSubscriberStatus, NewsletterSubscriberSource } from '../models/NewsletterSubscriber';
import type { NewsletterCampaignStatus } from '../models/NewsletterCampaign';
import type { NewsletterRecipientStatus } from '../models/NewsletterCampaignRecipient';

const meta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
const int = (v: unknown, fallback: number) => parseInt(String(v ?? ''), 10) || fallback;

/** Respuesta única del alta pública: no revela si la dirección ya estaba en la lista. */
/** Nombre de ejemplo para `{{nombre}}` en la vista previa y en el envío de prueba. */
const SAMPLE_NAME = 'María';

const SUBSCRIBE_MESSAGE = 'Listo. Si la dirección es correcta, te va a llegar un mail para confirmar la suscripción.';

// ─── Públicos (tienda) ───────────────────────────────────────────────────────

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    await newsletter.requestSubscription(
      {
        email: req.body.email,
        name: req.body.name,
        source: 'footer',
        // Desde el footer siempre hay doble opt-in, aun logueado: la dirección
        // cargada puede no ser la de la cuenta. El atajo sin confirmación vive
        // en "Mis datos" (`setMyNewsletter`), que usa el email de la cuenta.
        customerId: req.storeCustomerId ?? null,
      },
      meta(req)
    );
    res.json({ success: true, data: { message: SUBSCRIBE_MESSAGE } });
  } catch (err) { next(err); }
}

export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await newsletter.confirmSubscription(String(req.query.token));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function unsubscribeInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await newsletter.getUnsubscribeInfo(req.params.token);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * Baja. La usan dos clientes distintos:
 *  - la página `/tienda/newsletter/baja/:token` (JSON, `reason=link`);
 *  - el botón "Cancelar suscripción" de Gmail/Yahoo (RFC 8058): POST con cuerpo
 *    `List-Unsubscribe=One-Click` (form-urlencoded), sin JS ni cookies.
 */
export async function unsubscribe(req: Request, res: Response, next: NextFunction) {
  try {
    const oneClick = req.body?.['List-Unsubscribe'] === 'One-Click';
    const campaignId = req.query.c ? int(req.query.c, 0) : undefined;
    await newsletter.unsubscribeByToken(req.params.token, oneClick ? 'one_click' : 'link', campaignId);
    res.json({ success: true, data: { message: 'Te diste de baja. No vas a recibir más novedades.' } });
  } catch (err) { next(err); }
}

export async function getMyNewsletter(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await newsletter.getCustomerNewsletter(req.storeCustomerId!) });
  } catch (err) { next(err); }
}

export async function setMyNewsletter(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await newsletter.setCustomerNewsletter(req.storeCustomerId!, req.body.subscribed === true, meta(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─── Webhook de Resend ───────────────────────────────────────────────────────

export async function resendWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = (req as Request & { rawBody?: string }).rawBody;
    const event = raw
      ? verifyResendWebhook(raw, {
          id: req.get('svix-id'),
          timestamp: req.get('svix-timestamp'),
          signature: req.get('svix-signature'),
        })
      : null;
    if (!event) {
      logger.warn('newsletter.webhook.rejected', { message: 'Firma inválida o RESEND_WEBHOOK_SECRET sin configurar' });
      res.sendStatus(401);
      return;
    }
    await handleResendEvent(event as Parameters<typeof handleResendEvent>[0]);
    res.sendStatus(200);
  } catch (err) { next(err); }
}

// ─── Panel: suscriptores ─────────────────────────────────────────────────────

function subscriberFilters(req: Request) {
  return {
    search: (req.query.search as string) || undefined,
    status: (req.query.status as NewsletterSubscriberStatus) || undefined,
    source: (req.query.source as NewsletterSubscriberSource) || undefined,
  };
}

export async function listSubscribers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = int(req.query.page, 1);
    const limit = Math.min(int(req.query.limit, 50), 200);
    const { rows, count } = await newsletter.listSubscribers({ ...subscriberFilters(req), page, limit });
    res.json({ success: true, data: rows, meta: { page, limit, total: count } });
  } catch (err) { next(err); }
}

export async function subscriberStats(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [stats, audiences] = await Promise.all([newsletter.subscriberStats(), newsletter.audienceCounts()]);
    res.json({ success: true, data: { ...stats, audiences, audience_labels: newsletter.AUDIENCE_LABELS } });
  } catch (err) { next(err); }
}

export async function addSubscriber(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sub = await newsletter.addSubscriberManually(req.body, req.user?.id);
    res.status(201).json({ success: true, data: sub });
  } catch (err) { next(err); }
}

export async function unsubscribeSubscriber(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sub = await newsletter.adminUnsubscribe(int(req.params.id, 0));
    res.json({ success: true, data: sub });
  } catch (err) { next(err); }
}

export async function deleteSubscriber(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await newsletter.deleteSubscriber(int(req.params.id, 0));
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}

export async function exportSubscribers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const csv = await newsletter.exportSubscribersCsv(subscriberFilters(req));
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="suscriptores-${date}.csv"`);
    // BOM para que Excel abra bien los acentos.
    res.send(`﻿${csv}`);
  } catch (err) { next(err); }
}

export async function importCustomers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await newsletter.importExistingCustomers(req.user?.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─── Panel: campañas ─────────────────────────────────────────────────────────

export async function listCampaigns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = int(req.query.page, 1);
    const limit = Math.min(int(req.query.limit, 20), 100);
    const { rows, count } = await newsletter.listCampaigns({
      status: (req.query.status as NewsletterCampaignStatus) || undefined,
      page,
      limit,
    });
    res.json({ success: true, data: rows, meta: { page, limit, total: count } });
  } catch (err) { next(err); }
}

export async function getCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await newsletter.getCampaign(int(req.params.id, 0)) });
  } catch (err) { next(err); }
}

export async function createCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, data: await newsletter.createCampaign(req.body, req.user?.id) });
  } catch (err) { next(err); }
}

export async function updateCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await newsletter.updateCampaign(int(req.params.id, 0), req.body, req.user?.id) });
  } catch (err) { next(err); }
}

export async function deleteCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await newsletter.deleteCampaign(int(req.params.id, 0));
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}

export async function duplicateCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, data: await newsletter.duplicateCampaign(int(req.params.id, 0), req.user?.id) });
  } catch (err) { next(err); }
}

export async function previewCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await newsletter.previewCampaign(req.body, SAMPLE_NAME) });
  } catch (err) { next(err); }
}

export async function testCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await newsletter.sendTestEmail(int(req.params.id, 0), req.body.emails, SAMPLE_NAME);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function sendCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const at = req.body.scheduled_at ? new Date(req.body.scheduled_at) : null;
    res.json({ success: true, data: await newsletter.scheduleCampaign(int(req.params.id, 0), at, req.user?.id) });
  } catch (err) { next(err); }
}

export async function cancelCampaign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await newsletter.cancelCampaign(int(req.params.id, 0)) });
  } catch (err) { next(err); }
}

export async function listRecipients(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = int(req.query.page, 1);
    const limit = Math.min(int(req.query.limit, 50), 200);
    const { rows, count } = await newsletter.listRecipients(int(req.params.id, 0), {
      status: (req.query.status as NewsletterRecipientStatus) || undefined,
      page,
      limit,
    });
    res.json({ success: true, data: rows, meta: { page, limit, total: count } });
  } catch (err) { next(err); }
}
