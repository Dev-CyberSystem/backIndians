import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { requireStoreAuth, optionalStoreAuth } from '../middlewares/storeAuth';
import { upload } from '../middlewares/upload';
import * as ctrl from '../controllers/store.controller';

const router = Router();

// ─── Settings públicas ───────────────────────────────────────────────────────
router.get('/settings', ctrl.getStoreSettings);

// ─── SSE: actualizaciones en tiempo real ────────────────────────────────────
router.get('/events', ctrl.sseStoreEvents);

// ─── Auth de compradores (público) ──────────────────────────────────────────
router.post('/auth/register', ctrl.register);
router.get('/auth/verify-email', ctrl.verifyEmail);
router.post('/auth/login', ctrl.login);
router.post('/auth/google', ctrl.googleAuth);
router.post('/auth/refresh', ctrl.refreshToken);
router.post('/auth/forgot-password', ctrl.forgotPassword);
router.post('/auth/reset-password', ctrl.resetPassword);

// ─── Perfil del comprador (requiere auth de tienda) ─────────────────────────
router.get('/me', requireStoreAuth, ctrl.getProfile);
router.put('/me', requireStoreAuth, ctrl.updateProfile);
router.post('/me/addresses', requireStoreAuth, ctrl.upsertAddress);
router.delete('/me/addresses/:addressId', requireStoreAuth, ctrl.deleteAddress);
router.get('/me/orders', requireStoreAuth, ctrl.getMyOrders);
router.get('/me/orders/:orderNumber/invoice', requireStoreAuth, ctrl.downloadMyInvoice);

// ─── Tracking de comportamiento (públicos, fire & forget) ────────────────────
router.post('/track', ctrl.trackEvent);
router.get('/trending', ctrl.getTrending);
router.get('/products/by-ids', ctrl.getProductsByIds);
router.get('/products/:id/also-viewed', ctrl.getAlsoViewed);

// ─── Productos públicos ──────────────────────────────────────────────────────
router.get('/products/filters', ctrl.getFilterOptions);
router.get('/products', ctrl.listProducts);
router.get('/products/:id', ctrl.getProduct);

// ─── Cupones (validar, público) ──────────────────────────────────────────────
router.post('/coupons/validate', ctrl.validateCoupon);
router.get('/promo-popup', ctrl.getPromoPopup);

// ─── Checkout (auth opcional — compradores sin cuenta también pueden comprar) ─
router.post('/checkout', optionalStoreAuth, ctrl.checkout);

// ─── Confirmación y estado de pago (público) ─────────────────────────────────
router.post('/payment/confirm', ctrl.confirmPayment);
router.get('/orders/:orderNumber/status', ctrl.getOrderStatus);

// ─── Comprobante de transferencia bancaria (auth opcional — guests pasan email en body) ──
router.post('/orders/:orderNumber/payment-proof', optionalStoreAuth, upload.single('file'), ctrl.uploadPaymentProof);

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
