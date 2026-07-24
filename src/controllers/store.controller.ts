import { Request, Response, NextFunction } from 'express';
import * as storeAuth from '../services/store.auth.service';
import * as store from '../services/store.service';
import * as analytics from '../services/storeAnalytics.service';
import * as wishlistService from '../services/store.wishlist.service';
import { StoreOrderStatus } from '../models/StoreOrder';
import { cloudinary } from '../config/cloudinary';
import { storeEvents } from '../events/storeEvents';
import { verifyWebhookSignature } from '../services/mercadopago.service';
import * as abandonedCart from '../services/abandonedCart.service';
import { AuthRequest } from '../types';

// ─── Settings públicas ────────────────────────────────────────────────────────

export async function getStoreSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await store.getPublicStoreSettings();
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await storeAuth.storeRegisterService(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    await storeAuth.storeVerifyEmailService(req.query.token as string);
    res.json({ success: true, data: { message: 'Email verificado correctamente' } });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await storeAuth.storeLoginService(req.body.email, req.body.password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function googleAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await storeAuth.storeGoogleAuthService(req.body.id_token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const tokens = await storeAuth.storeRefreshTokenService(req.body.refresh_token);
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await storeAuth.storeForgotPasswordService(req.body.email);
    res.json({ success: true, data: { message: 'Si el email existe, recibirás las instrucciones.' } });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await storeAuth.storeResetPasswordService(req.body.token, req.body.password);
    res.json({ success: true, data: { message: 'Contraseña actualizada' } });
  } catch (err) {
    next(err);
  }
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await storeAuth.storeGetProfileService(req.storeCustomerId!);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await storeAuth.storeUpdateProfileService(req.storeCustomerId!, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function upsertAddress(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await storeAuth.storeUpsertAddressService(req.storeCustomerId!, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function deleteAddress(req: Request, res: Response, next: NextFunction) {
  try {
    await storeAuth.storeDeleteAddressService(req.storeCustomerId!, Number(req.params.addressId));
    res.json({ success: true, data: { message: 'Dirección eliminada' } });
  } catch (err) {
    next(err);
  }
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export async function getWishlist(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = await wishlistService.getWishlistIds(req.storeCustomerId!);
    res.json({ success: true, data: { ids } });
  } catch (err) { next(err); }
}

export async function toggleWishlistItem(req: Request, res: Response, next: NextFunction) {
  try {
    const productId = Number(req.params.productId);
    const ids = await wishlistService.toggleWishlistItem(req.storeCustomerId!, productId);
    res.json({ success: true, data: { ids } });
  } catch (err) { next(err); }
}

export async function mergeWishlist(req: Request, res: Response, next: NextFunction) {
  try {
    const productIds: number[] = (req.body.ids ?? []).map(Number).filter(Boolean);
    const ids = await wishlistService.mergeWishlistItems(req.storeCustomerId!, productIds);
    res.json({ success: true, data: { ids } });
  } catch (err) { next(err); }
}

// ─── Productos ───────────────────────────────────────────────────────────────

export async function listProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, category, gender, tag, garment_type_id, size, price_min, price_max, sort, client_id, page, limit } = req.query;
    const result = await store.listStoreProducts({
      search:          search          as string | undefined,
      category:        category        as string | undefined,
      gender:          gender          as string | undefined,
      tag:             tag             as string | undefined,
      garment_type_id: garment_type_id ? Number(garment_type_id) : undefined,
      size:            size            as string | undefined,
      price_min:       price_min ? Number(price_min) : undefined,
      price_max:       price_max ? Number(price_max) : undefined,
      sort:            sort as store.StoreProductSort | undefined,
      client_id:       client_id ? Number(client_id) : undefined,
      page:            page  ? Number(page)  : undefined,
      limit:           limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function getFilterOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await store.getStoreFilterOptions();
    res.json({ success: true, data: options });
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await store.getStoreProduct(Number(req.params.id));
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

// ─── Cupones ────────────────────────────────────────────────────────────────

export async function validateCoupon(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, subtotal } = req.body;
    const result = await store.validateCoupon(code, Number(subtotal));
    res.json({ success: true, data: { discount: result.discount, coupon: { code: result.coupon.code, type: result.coupon.type, value: result.coupon.value } } });
  } catch (err) {
    next(err);
  }
}

// Popup promocional de la tienda (público)
export async function getPromoPopup(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await store.getPromoPopupCoupon() });
  } catch (err) {
    next(err);
  }
}

// Admin: gestión de cupones
export async function listCoupons(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await store.listCoupons() });
  } catch (err) {
    next(err);
  }
}

export async function createCoupon(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ success: true, data: await store.createCoupon(req.body) });
  } catch (err) {
    next(err);
  }
}

export async function updateCoupon(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await store.updateCoupon(Number(req.params.id), req.body) });
  } catch (err) {
    next(err);
  }
}

export async function deleteCoupon(req: Request, res: Response, next: NextFunction) {
  try {
    await store.deleteCoupon(Number(req.params.id));
    res.json({ success: true, data: { message: 'Cupón eliminado' } });
  } catch (err) {
    next(err);
  }
}

// ─── Checkout / Pedidos ──────────────────────────────────────────────────────

export async function checkout(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await store.createStoreOrder({
      ...req.body,
      customerId: req.storeCustomerId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const paymentId = req.query['data.id'] || req.body?.data?.id;

    // Rechazar webhooks con firma inválida (si MP_WEBHOOK_SECRET está configurado).
    const valid = verifyWebhookSignature({
      dataId: paymentId != null ? String(paymentId) : undefined,
      xSignature: req.headers['x-signature'] as string | undefined,
      xRequestId: req.headers['x-request-id'] as string | undefined,
    });
    if (!valid) {
      res.sendStatus(401);
      return;
    }

    if (paymentId) await store.handleStoreWebhook(String(paymentId));
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
}

// ─── Comprobante de pago (transferencia bancaria) ────────────────────────────

export async function uploadPaymentProof(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
      return;
    }

    const orderNumber = req.params.orderNumber;
    // Si hay JWT de tienda, usamos ese email; de lo contrario, el body debe traer customer_email
    const customerEmail: string | undefined = req.storeCustomerEmail ?? req.body.customer_email;
    if (!customerEmail) {
      res.status(400).json({ success: false, message: 'Se requiere el email del comprador' });
      return;
    }

    // Subir imagen a Cloudinary como asset `authenticated`: no accesible por URL
    // pública; se sirve luego con URLs firmadas generadas en cada lectura.
    const uploaded = await new Promise<{ url: string; publicId: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'indians/payment-proofs', resource_type: 'image', type: 'authenticated' },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error('Upload fallido'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      ).end(req.file!.buffer);
    });

    const order = await store.savePaymentProof(orderNumber, customerEmail, uploaded.url, uploaded.publicId);
    res.json({ success: true, data: { order: store.signPaymentProofs(order.toJSON()) } });
  } catch (err) {
    next(err);
  }
}

// Confirmación de pago al volver el cliente desde MercadoPago (público)
export async function confirmPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const paymentId =
      req.body?.payment_id ?? req.body?.collection_id ?? req.query.payment_id ?? req.query.collection_id;
    const orderNumber = req.body?.order ?? req.body?.external_reference ?? req.query.order;
    const result = await store.confirmStorePayment({
      paymentId: paymentId ? String(paymentId) : null,
      orderNumber: orderNumber ? String(orderNumber) : null,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// Consulta de estado de un pedido por número (público, para polling)
export async function getOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await store.getStoreOrderStatusByNumber(String(req.params.orderNumber));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// Admin
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, customer_id, search, page, limit, date_from, date_to } = req.query;
    const result = await store.listStoreOrders({
      status: status as string | undefined,
      customer_id: customer_id ? Number(customer_id) : undefined,
      search: search as string | undefined,
      date_from: date_from as string | undefined,
      date_to: date_to as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await store.getStoreOrderById(Number(req.params.id));
    res.json({ success: true, data: store.signPaymentProofs(order.toJSON()) });
  } catch (err) {
    next(err);
  }
}

export async function updateOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, tracking_number, courier_name, note } = req.body;
    const adminId = (req as unknown as AuthRequest).user?.id ?? null;
    const { order, emailQueued } = await store.updateStoreOrderStatus(
      Number(req.params.id),
      status as StoreOrderStatus,
      { tracking_number: tracking_number ?? undefined, courier_name: courier_name ?? undefined },
      adminId,
      note ?? null,
    );
    // email_queued va dentro de data (no en meta: el interceptor admin trata meta
    // como paginación). Es un campo transitorio para el feedback de la UI.
    res.json({
      success: true,
      data: { ...store.signPaymentProofs(order.toJSON()), email_queued: emailQueued },
    });
  } catch (err) {
    next(err);
  }
}

// Admin: regenerar el token del link de seguimiento
export async function regenerateOrderTracking(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await store.regenerateTrackingToken(Number(req.params.id));
    res.json({ success: true, data: { tracking_url: store.buildTrackingUrl(order.tracking_token!) } });
  } catch (err) {
    next(err);
  }
}

// Público: seguimiento por token opaco (sin login). 404 si no existe, 410 si venció.
export async function getOrderTracking(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await store.getStoreOrderTrackingByToken(String(req.params.token));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// Comprador logueado: seguimiento de un pedido propio (no afectado por vencimiento).
export async function getMyOrderTracking(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await store.getStoreOrderTrackingForCustomer(
      String(req.params.orderNumber),
      req.storeCustomerId!,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function sendInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    await store.sendStoreOrderInvoiceEmail(Number(req.params.id));
    res.json({ success: true, data: { message: 'Factura enviada por email' } });
  } catch (err) {
    next(err);
  }
}

export async function downloadInvoiceAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { buffer, orderNumber } = await store.getStoreOrderInvoicePdfBuffer(Number(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${orderNumber}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function downloadMyInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await store.getStoreOrderByNumberForCustomer(
      String(req.params.orderNumber),
      req.storeCustomerId!
    );
    const paidStatuses = ['paid', 'processing', 'review', 'awaiting_courier', 'shipped', 'delivered'];
    if (!paidStatuses.includes(order.status)) {
      res.status(403).json({ success: false, message: 'La factura solo está disponible para pedidos pagados' });
      return;
    }
    const { buffer } = await store.getStoreOrderInvoicePdfBuffer(order.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${order.order_number}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function getMyOrders(req: Request, res: Response, next: NextFunction) {
  try {
    // Traer el email del cliente para incluir pedidos hechos como invitado con ese email
    let customerEmail: string | undefined;
    try {
      const profile = await storeAuth.storeGetProfileService(req.storeCustomerId!);
      customerEmail = profile.email;
    } catch { /* si falla, igual filtramos por customer_id */ }

    const result = await store.listStoreOrders({
      customer_id: req.storeCustomerId,
      customer_email: customerEmail,
      page: req.query.page ? Number(req.query.page) : 1,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

// ─── Analytics de comportamiento ─────────────────────────────────────────────

export async function trackEvent(req: Request, res: Response): Promise<void> {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.socket.remoteAddress ?? '';

    await analytics.trackStoreEvent({ ...req.body, ip: rawIp });
  } catch {
    // fire and forget — nunca falla al cliente
  }
  res.status(204).end();
}

export async function getTrending(req: Request, res: Response, next: NextFunction) {
  try {
    const { city, days, limit } = req.query;
    const products = await analytics.getTrendingProducts({
      city: city as string | undefined,
      days: days ? Number(days) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

export async function getAlsoViewed(req: Request, res: Response, next: NextFunction) {
  try {
    const { limit } = req.query;
    const products = await analytics.getAlsoViewed(
      Number(req.params.id),
      limit ? Number(limit) : undefined,
    );
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

export async function getProductsByIds(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = (req.query.ids as string | undefined) ?? '';
    const ids = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n))
      .slice(0, 20);
    const products = await analytics.getProductsByIds(ids);
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

export async function getEventAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const { period } = req.query;
    const result = await analytics.getEventAnalytics(period as string | undefined);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── Métricas ────────────────────────────────────────────────────────────────

export async function getMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const metrics = await store.getStoreMetrics(req.query.period as string | undefined);
    res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
}

export async function getAudience(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await analytics.getAudienceMetrics(req.query.period as string | undefined);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getAbandonedCarts(_req: Request, res: Response, next: NextFunction) {
  try {
    const carts = await abandonedCart.getAbandonedCarts();
    res.json({ success: true, data: carts });
  } catch (err) {
    next(err);
  }
}

export async function sendAbandonedCartReminder(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = (req as unknown as AuthRequest).user!.id;
    await abandonedCart.sendAbandonedCartReminder(Number(req.params.customerId), adminId);
    res.json({ success: true, data: { message: 'Email de recupero enviado' } });
  } catch (err) {
    next(err);
  }
}

// ─── SSE: eventos en tiempo real para la tienda pública ──────────────────────

// Tope de conexiones SSE simultáneas por IP. Cada conexión es un socket abierto
// (no cuenta contra el rate-limiter, que mide requests). Sin este cap, un cliente
// podría abrir cientos de EventSource y agotar los sockets/handlers del proceso.
const sseConnectionsByIp = new Map<string, number>();
const MAX_SSE_PER_IP = 5;

export function sseStoreEvents(req: Request, res: Response) {
  const ip = req.ip || 'unknown';
  const current = sseConnectionsByIp.get(ip) ?? 0;
  if (current >= MAX_SSE_PER_IP) {
    res.status(429).json({ success: false, message: 'Demasiadas conexiones simultáneas' });
    return;
  }
  sseConnectionsByIp.set(ip, current + 1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // necesario detrás de nginx
  res.flushHeaders();

  // Confirma la conexión al cliente
  res.write('data: {"type":"connected"}\n\n');

  // Keepalive para evitar que proxies o el cliente cierren la conexión idle
  const ping = setInterval(() => { res.write(': ping\n\n'); }, 25_000);

  function onProductsChanged() {
    res.write('data: {"type":"products_changed"}\n\n');
  }

  storeEvents.on('products_changed', onProductsChanged);

  req.on('close', () => {
    clearInterval(ping);
    storeEvents.off('products_changed', onProductsChanged);
    const n = (sseConnectionsByIp.get(ip) ?? 1) - 1;
    if (n <= 0) sseConnectionsByIp.delete(ip);
    else sseConnectionsByIp.set(ip, n);
  });
}
