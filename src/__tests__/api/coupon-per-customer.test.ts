import jwt from 'jsonwebtoken';
import { api, API, loginAs, auth } from './helpers';
import { StoreCustomer } from '../../models/StoreCustomer';

/*
 * 1 uso por cliente (2.8), además del `max_uses` global que ya existía.
 * Identifica al comprador por `customer_id` (logueado) o `customer_email`
 * (invitado). Usa un cupón y un producto propios por test.
 */

describe('Cupón — 1 uso por cliente (2.8)', () => {
  let admin: string;
  let clientId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createTestProduct(): Promise<number> {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId, title: `Producto Cupon QA ${Date.now()}-${Math.random()}`,
      price: 5000, stock_quantity: 20, show_in_store: true, active: true,
    });
    return res.body.data.id;
  }

  async function createTestCoupon(): Promise<string> {
    const code = `QACUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const res = await api().post(`${API}/store/admin/coupons`).set(...auth(admin)).send({
      code, type: 'fixed', value: 500, max_uses: 10, // el límite global no es lo que se prueba acá
    });
    expect(res.status).toBe(201);
    return code;
  }

  it('un invitado puede usar el cupón una vez; un segundo pedido con el mismo email lo rechaza', async () => {
    const couponCode = await createTestCoupon();
    const email = `qa-cupon-invitado+${Date.now()}@test.local`;
    const productId = await createTestProduct();

    const first = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon', customerEmail: email, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(first.status).toBe(201);
    expect(Number(first.body.data.order.discount_amount)).toBe(500);

    const second = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon', customerEmail: email, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(second.status).toBe(400);
    expect(String(second.body.message ?? second.body.error)).toMatch(/una sola vez por cliente/i);
  });

  it('un email distinto sí puede usar el mismo cupón', async () => {
    const couponCode = await createTestCoupon();
    const productId = await createTestProduct();

    const email1 = `qa-cupon-a+${Date.now()}@test.local`;
    const first = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon A', customerEmail: email1, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(first.status).toBe(201);

    const email2 = `qa-cupon-b+${Date.now()}@test.local`;
    const second = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon B', customerEmail: email2, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(second.status).toBe(201);
  });

  it('un pedido cancelado no cuenta como "usado" — el cliente puede volver a usar el cupón', async () => {
    const couponCode = await createTestCoupon();
    const email = `qa-cupon-cancelado+${Date.now()}@test.local`;
    const productId = await createTestProduct();

    const first = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon Cancelado', customerEmail: email, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(first.status).toBe(201);

    await api()
      .patch(`${API}/store/admin/orders/${first.body.data.order.id}/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });

    const second = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cupon Cancelado', customerEmail: email, customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
    });
    expect(second.status).toBe(201);
  });

  it('un comprador logueado: /coupons/validate detecta el reuso por customer_id, no solo por email', async () => {
    const couponCode = await createTestCoupon();
    const productId = await createTestProduct();

    const customer = await StoreCustomer.create({
      name: 'Robot QA Logueado',
      email: `qa-cupon-logueado+${Date.now()}@test.local`,
      password_hash: 'x',
      email_verified: true,
    });
    const secret = process.env.STORE_JWT_SECRET || process.env.JWT_SECRET!;
    const token = jwt.sign(
      { sub: customer.id, email: customer.email, type: 'store_customer', session_version: 1 },
      secret,
      { expiresIn: '15m' }
    );

    const checkout = await api()
      .post(`${API}/store/checkout`)
      .set('Authorization', `Bearer ${token}`)
      .send({
      accept_terms: true,
        customerName: customer.name, customerEmail: customer.email, customerPhone: '1100000000',
        items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
        shipping_type: 'pickup', payment_method: 'bank_transfer', coupon_code: couponCode,
      });
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.order.customer_id).toBe(customer.id);

    // /coupons/validate con el mismo token (auth opcional, 2.8) tiene que
    // detectar el reuso sin necesidad de mandar el email en el body.
    const validate = await api()
      .post(`${API}/store/coupons/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: couponCode, subtotal: 5000 });
    expect(validate.status).toBe(400);
    expect(String(validate.body.message ?? validate.body.error)).toMatch(/una sola vez por cliente/i);
  });
});
