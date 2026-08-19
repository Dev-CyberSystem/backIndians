import { api, API, loginAs, auth } from './helpers';
import { expireStaleOrders } from '../../jobs/expireStaleOrders';
import { StoreOrder } from '../../models/StoreOrder';
import { CatalogProduct } from '../../models/CatalogProduct';

/*
 * Job de expiración de pedidos impagos (2.2 — Fase 2). Misma ventana (48hs
 * por default) para MercadoPago y transferencia (decisión de negocio #3).
 * Usa productos propios (fixtures por test) para tener stock determinístico.
 */

describe('Job de expiración de pedidos impagos — 2.2', () => {
  let admin: string;
  let clientId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createTestProduct(stock: number): Promise<number> {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Expiracion QA ${Date.now()}-${Math.random()}`,
      price: 4000,
      stock_quantity: stock,
      show_in_store: true,
      active: true,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  async function createOrder(
    productId: number,
    paymentMethod: 'mercadopago' | 'bank_transfer' | 'cash',
    hoursOld: number,
    extra: Record<string, unknown> = {}
  ): Promise<{ orderId: number; orderNumber: string }> {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Expiracion',
      customerEmail: `qa-expira+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: paymentMethod,
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    const oldDate = new Date(Date.now() - hoursOld * 3_600_000);
    await StoreOrder.update({ createdAt: oldDate, ...extra }, { where: { id: order.id }, silent: true });

    return { orderId: order.id, orderNumber: order.order_number };
  }

  it('un pedido de MercadoPago pending_payment de más de 48hs se cancela y libera la reserva', async () => {
    const productId = await createTestProduct(5);
    const { orderId } = await createOrder(productId, 'mercadopago', 49);

    const result = await expireStaleOrders();
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('cancelled');
    expect(order!.stock_restored_at).not.toBeNull();

    const product = await CatalogProduct.findByPk(productId);
    expect(product!.stock_reserved).toBe(0); // reserva liberada
    expect(product!.stock_quantity).toBe(5); // nunca se había confirmado el pago
  });

  it('un pedido de transferencia pending_payment de más de 48hs SIN comprobante subido se cancela igual que MercadoPago', async () => {
    const productId = await createTestProduct(3);
    const { orderId } = await createOrder(productId, 'bank_transfer', 49);

    const result = await expireStaleOrders();
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('cancelled');
  });

  it('un pedido de transferencia con comprobante YA subido no se cancela solo (queda para revisión del admin)', async () => {
    const productId = await createTestProduct(3);
    const { orderId } = await createOrder(productId, 'bank_transfer', 49, {
      payment_proof_url: 'https://res.cloudinary.com/qa/comprobante-fake.jpg',
    });

    await expireStaleOrders();

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('pending_payment'); // sin cambios

    const product = await CatalogProduct.findByPk(productId);
    expect(product!.stock_reserved).toBe(1); // la reserva sigue en pie
  });

  it('un pedido en efectivo no expira automáticamente (pago/retiro en persona)', async () => {
    const productId = await createTestProduct(3);
    const { orderId } = await createOrder(productId, 'cash', 49);

    await expireStaleOrders();

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('pending_payment'); // sin cambios
  });

  it('un pedido reciente (dentro de la ventana) no se toca', async () => {
    const productId = await createTestProduct(3);
    const { orderId } = await createOrder(productId, 'mercadopago', 1); // 1hs, no 48

    await expireStaleOrders();

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('pending_payment'); // sin cambios
  });
});
