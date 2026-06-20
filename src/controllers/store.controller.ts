import { Request, Response, NextFunction } from 'express';
import * as storeAuth from '../services/store.auth.service';
import * as store from '../services/store.service';
import { StoreOrderStatus } from '../models/StoreOrder';

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

// ─── Productos ───────────────────────────────────────────────────────────────

export async function listProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, category, gender, size, price_min, price_max, sort, client_id, page, limit } = req.query;
    const result = await store.listStoreProducts({
      search:    search    as string | undefined,
      category:  category  as string | undefined,
      gender:    gender    as string | undefined,
      size:      size      as string | undefined,
      price_min: price_min ? Number(price_min) : undefined,
      price_max: price_max ? Number(price_max) : undefined,
      sort:      sort as store.StoreProductSort | undefined,
      client_id: client_id ? Number(client_id) : undefined,
      page:      page  ? Number(page)  : undefined,
      limit:     limit ? Number(limit) : undefined,
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
    if (paymentId) await store.handleStoreWebhook(String(paymentId));
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
}

// Admin
export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, customer_id, search, page, limit } = req.query;
    const result = await store.listStoreOrders({
      status: status as string | undefined,
      customer_id: customer_id ? Number(customer_id) : undefined,
      search: search as string | undefined,
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
    res.json({ success: true, data: await store.getStoreOrderById(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
}

export async function updateOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await store.updateStoreOrderStatus(Number(req.params.id), req.body.status as StoreOrderStatus) });
  } catch (err) {
    next(err);
  }
}

export async function getMyOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await store.listStoreOrders({
      customer_id: req.storeCustomerId,
      page: req.query.page ? Number(req.query.page) : 1,
    });
    res.json({ success: true, data: result.data, meta: result.meta });
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
