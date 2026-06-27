import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { requireStoreAuth, optionalStoreAuth } from '../middlewares/storeAuth';
import { upload } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import { verifyTurnstile } from '../middlewares/turnstile';
import {
  authLimiter,
  passwordResetLimiter,
  checkoutLimiter,
  couponLimiter,
  paymentProofLimiter,
  paymentStatusLimiter,
  trackLimiter,
} from '../middlewares/rateLimit';
import * as ctrl from '../controllers/store.controller';

const router = Router();

// ─── Validadores de inputs públicos (defensa en profundidad) ─────────────────
// Sequelize ya parametriza las queries (no hay SQLi), pero acotamos tipo/forma/
// longitud para rechazar payloads basura, payloads gigantes y abuso de bots antes
// de llegar al service.
const emailField = (f: string) => body(f).trim().isEmail().withMessage('Email inválido').isLength({ max: 254 }).normalizeEmail();

const registerValidators = [
  body('name').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 120 }),
  emailField('email'),
  body('password').isString().isLength({ min: 6, max: 100 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  validate,
];

const loginValidators = [
  emailField('email'),
  body('password').isString().notEmpty().withMessage('Contraseña requerida').isLength({ max: 100 }),
  validate,
];

const checkoutValidators = [
  body('customerName').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 120 }),
  body('customerEmail').trim().isEmail().withMessage('Email inválido').isLength({ max: 254 }),
  body('customerPhone').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('items').isArray({ min: 1 }).withMessage('El carrito está vacío'),
  body('items.*.catalog_product_id').isInt({ min: 1 }).withMessage('Producto inválido'),
  body('items.*.quantity').isInt({ min: 1, max: 1000 }).withMessage('Cantidad inválida'),
  body('items.*.size_name').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('shipping_type').optional().isIn(['pickup', 'delivery']).withMessage('Tipo de envío inválido'),
  body('payment_method').optional().isIn(['mercadopago', 'cash', 'bank_transfer']).withMessage('Método de pago inválido'),
  body('coupon_code').optional({ nullable: true }).isString().isLength({ max: 64 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  validate,
];

const couponValidators = [
  body('code').isString().withMessage('Código requerido').trim().notEmpty().isLength({ max: 64 }),
  body('subtotal').isFloat({ min: 0 }).withMessage('Subtotal inválido'),
  validate,
];

const productQueryValidators = [
  query('search').optional().isString().isLength({ max: 120 }),
  query('category').optional().isString().isLength({ max: 60 }),
  query('gender').optional().isString().isLength({ max: 30 }),
  query('tag').optional().isString().isLength({ max: 60 }),
  query('size').optional().isString().isLength({ max: 60 }),
  query('sort').optional().isIn(['newest', 'price_asc', 'price_desc', 'name_asc']),
  query('garment_type_id').optional().isInt({ min: 1 }),
  query('client_id').optional().isInt({ min: 1 }),
  query('price_min').optional().isFloat({ min: 0 }),
  query('price_max').optional().isFloat({ min: 0 }),
  query('page').optional().isInt({ min: 1, max: 100000 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate,
];

// Cache-Control para GET públicos: el navegador/CDN sirve sin pegarle al backend
// durante `s` segundos. Datos públicos sin info de usuario.
const cache = (s: number) => (_req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  res.set('Cache-Control', `public, max-age=${s}`);
  next();
};

// ─── Settings públicas ───────────────────────────────────────────────────────
router.get('/settings', cache(60), ctrl.getStoreSettings);

// ─── SSE: actualizaciones en tiempo real ────────────────────────────────────
router.get('/events', ctrl.sseStoreEvents);

// ─── Auth de compradores (público) ──────────────────────────────────────────
router.post('/auth/register', authLimiter, verifyTurnstile, registerValidators, ctrl.register);
router.get('/auth/verify-email', query('token').isString().notEmpty().isLength({ max: 200 }), validate, ctrl.verifyEmail);
router.post('/auth/login', authLimiter, loginValidators, ctrl.login);
router.post('/auth/google', authLimiter, body('id_token').isString().notEmpty(), validate, ctrl.googleAuth);
router.post('/auth/refresh', body('refresh_token').isString().notEmpty(), validate, ctrl.refreshToken);
router.post('/auth/forgot-password', passwordResetLimiter, emailField('email'), validate, ctrl.forgotPassword);
router.post('/auth/reset-password', authLimiter, [body('token').isString().notEmpty(), body('password').isString().isLength({ min: 6, max: 100 }), validate], ctrl.resetPassword);

// ─── Perfil del comprador (requiere auth de tienda) ─────────────────────────
router.get('/me', requireStoreAuth, ctrl.getProfile);
router.put('/me', requireStoreAuth, ctrl.updateProfile);
router.post('/me/addresses', requireStoreAuth, ctrl.upsertAddress);
router.delete('/me/addresses/:addressId', requireStoreAuth, ctrl.deleteAddress);
router.get('/me/orders', requireStoreAuth, ctrl.getMyOrders);
router.get('/me/orders/:orderNumber/invoice', requireStoreAuth, ctrl.downloadMyInvoice);
router.get('/me/wishlist', requireStoreAuth, ctrl.getWishlist);
router.post('/me/wishlist/merge', requireStoreAuth, body('ids').isArray(), validate, ctrl.mergeWishlist);
router.post('/me/wishlist/:productId/toggle', requireStoreAuth, param('productId').isInt({ min: 1 }), validate, ctrl.toggleWishlistItem);

// ─── Tracking de comportamiento (públicos, fire & forget) ────────────────────
router.post('/track', trackLimiter, ctrl.trackEvent);
router.get('/trending', ctrl.getTrending);
router.get('/products/by-ids', ctrl.getProductsByIds);
router.get('/products/:id/also-viewed', ctrl.getAlsoViewed);

// ─── Productos públicos ──────────────────────────────────────────────────────
router.get('/products/filters', cache(60), ctrl.getFilterOptions);
router.get('/products', cache(20), productQueryValidators, ctrl.listProducts);
router.get('/products/:id', cache(30), param('id').isInt({ min: 1 }), validate, ctrl.getProduct);

// ─── Cupones (validar, público) ──────────────────────────────────────────────
router.post('/coupons/validate', couponLimiter, couponValidators, ctrl.validateCoupon);
router.get('/promo-popup', cache(30), ctrl.getPromoPopup);

// ─── Checkout (auth opcional — compradores sin cuenta también pueden comprar) ─
router.post('/checkout', checkoutLimiter, optionalStoreAuth, checkoutValidators, ctrl.checkout);

// ─── Confirmación y estado de pago (público) ─────────────────────────────────
router.post('/payment/confirm', paymentStatusLimiter, ctrl.confirmPayment);
router.get('/orders/:orderNumber/status', paymentStatusLimiter, param('orderNumber').isString().notEmpty().isLength({ max: 60 }), validate, ctrl.getOrderStatus);

// ─── Comprobante de transferencia bancaria (auth opcional — guests pasan email en body) ──
router.post('/orders/:orderNumber/payment-proof', paymentProofLimiter, optionalStoreAuth, upload.single('file'), ctrl.uploadPaymentProof);

// ─── Webhook MercadoPago (sin auth) ─────────────────────────────────────────
router.post('/webhook/mp', ctrl.webhook);

// ─── Admin: pedidos de la tienda ─────────────────────────────────────────────
router.get('/admin/orders', authenticate, authorize('admin', 'billing'), ctrl.listOrders);
router.get('/admin/orders/:id', authenticate, authorize('admin', 'billing'), ctrl.getOrder);
router.patch('/admin/orders/:id/status', authenticate, authorize('admin', 'billing'), ctrl.updateOrderStatus);
router.post('/admin/orders/:id/send-invoice', authenticate, authorize('admin', 'billing'), ctrl.sendInvoice);
router.get('/admin/orders/:id/invoice', authenticate, authorize('admin', 'billing'), ctrl.downloadInvoiceAdmin);

// ─── Admin: cupones ───────────────────────────────────────────────────────────
router.get('/admin/coupons', authenticate, authorize('admin', 'billing'), ctrl.listCoupons);
router.post('/admin/coupons', authenticate, authorize('admin', 'billing'), ctrl.createCoupon);
router.put('/admin/coupons/:id', authenticate, authorize('admin', 'billing'), ctrl.updateCoupon);
router.delete('/admin/coupons/:id', authenticate, authorize('admin', 'billing'), ctrl.deleteCoupon);

// ─── Admin: métricas ─────────────────────────────────────────────────────────
router.get('/admin/metrics', authenticate, authorize('admin', 'billing'), ctrl.getMetrics);

// ─── Admin: analytics de eventos ─────────────────────────────────────────────
router.get('/admin/event-analytics', authenticate, authorize('admin', 'billing'), ctrl.getEventAnalytics);

export default router;
