import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { webhookLimiter } from '../middlewares/rateLimit';
import * as ctrl from '../controllers/newsletter.controller';
import { NEWSLETTER_ROLES } from '../config/newsletter';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

/**
 * Newsletter — panel de gestión (suscriptores + campañas) y webhook de Resend.
 * Los endpoints públicos de la tienda (alta, confirmación, baja, "Mis datos")
 * viven en `store.routes.ts` bajo `/store/newsletter` y `/store/me/newsletter`.
 */
const router = Router();

// Webhook de Resend (sin auth de staff: lo autentica la firma Svix).
router.post('/webhook/resend', webhookLimiter, ctrl.resendWebhook);

router.use(authenticate);
const staff = authorize(...NEWSLETTER_ROLES);

const SUBSCRIBER_STATUSES = ['pending', 'subscribed', 'unsubscribed', 'bounced', 'complained'];
const SOURCES = ['footer', 'register', 'checkout', 'account', 'admin', 'existing_customer'];
const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'];
const RECIPIENT_STATUSES = ['queued', 'sent', 'failed', 'skipped'];
const AUDIENCES = ['all', 'customers', 'buyers', 'non_buyers'];

const idParam = [param('id').isInt({ min: 1 }).withMessage('ID inválido')];
const subscriberQuery = [
  query('search').optional().isString().isLength({ max: 120 }),
  query('status').optional().isIn(SUBSCRIBER_STATUSES),
  query('source').optional().isIn(SOURCES),
];

// ─── Suscriptores ────────────────────────────────────────────────────────────
router.get('/subscribers', staff, [...subscriberQuery,
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  validate], ctrl.listSubscribers);
router.get('/subscribers/stats', staff, ctrl.subscriberStats);
router.get('/subscribers/export', staff, [...subscriberQuery, validate], ctrl.exportSubscribers);
router.post('/subscribers', staff, [
  body('email').trim().isEmail().withMessage('Email inválido').isLength({ max: 254 }).normalizeEmail(EMAIL_NORMALIZE_OPTS),
  body('name').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  validate,
], ctrl.addSubscriber);
// Importación única de clientes registrados: decisión de alcance masivo → solo admin.
router.post('/subscribers/import-customers', authorize('admin'), ctrl.importCustomers);
router.patch('/subscribers/:id/unsubscribe', staff, [...idParam, validate], ctrl.unsubscribeSubscriber);
// Borrado definitivo (derecho de supresión) → solo admin.
router.delete('/subscribers/:id', authorize('admin'), [...idParam, validate], ctrl.deleteSubscriber);

// ─── Campañas ────────────────────────────────────────────────────────────────
const campaignBody = (partial: boolean) => {
  const opt = <T extends { optional: () => T }>(v: T) => (partial ? v.optional() : v);
  return [
    opt(body('name').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 150 })),
    opt(body('subject').isString().trim().notEmpty().withMessage('El asunto es obligatorio').isLength({ max: 200 })),
    body('preheader').optional({ nullable: true }).isString().isLength({ max: 200 }),
    opt(body('blocks').isArray({ max: 40 }).withMessage('Contenido inválido')),
    body('audience').optional().isIn(AUDIENCES).withMessage('Segmento inválido'),
  ];
};

router.get('/campaigns', staff, [
  query('status').optional().isIn(CAMPAIGN_STATUSES),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate,
], ctrl.listCampaigns);
router.post('/campaigns/preview', staff, [
  body('subject').optional().isString().isLength({ max: 200 }),
  body('preheader').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('blocks').isArray({ max: 40 }).withMessage('Contenido inválido'),
  validate,
], ctrl.previewCampaign);
router.get('/campaigns/:id', staff, [...idParam, validate], ctrl.getCampaign);
router.post('/campaigns', staff, [...campaignBody(false), validate], ctrl.createCampaign);
router.put('/campaigns/:id', staff, [...idParam, ...campaignBody(true), validate], ctrl.updateCampaign);
router.delete('/campaigns/:id', staff, [...idParam, validate], ctrl.deleteCampaign);
router.post('/campaigns/:id/duplicate', staff, [...idParam, validate], ctrl.duplicateCampaign);
router.post('/campaigns/:id/test', staff, [
  ...idParam,
  body('emails').isArray({ min: 1, max: 5 }).withMessage('Indicá entre 1 y 5 direcciones'),
  body('emails.*').isEmail().withMessage('Email inválido').isLength({ max: 254 }),
  validate,
], ctrl.testCampaign);
router.post('/campaigns/:id/send', staff, [
  ...idParam,
  body('scheduled_at').optional({ nullable: true }).isISO8601().withMessage('Fecha inválida'),
  validate,
], ctrl.sendCampaign);
router.post('/campaigns/:id/cancel', staff, [...idParam, validate], ctrl.cancelCampaign);
router.get('/campaigns/:id/recipients', staff, [
  ...idParam,
  query('status').optional().isIn(RECIPIENT_STATUSES),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  validate,
], ctrl.listRecipients);

export default router;
