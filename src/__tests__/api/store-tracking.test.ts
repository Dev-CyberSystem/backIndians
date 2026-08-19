/*
 * Seguimiento de pedidos de la tienda — integración por API (supertest).
 * Requiere MySQL migrado (migración 066) y seed del admin.
 *
 * Cubre:
 *  - cada cambio de estado desde admin encola el mail correcto al comprador,
 *  - el seguimiento público no es accesible sin un token válido (404),
 *  - un token vencido rechaza el acceso (410).
 *
 * Mockeamos solo `sendStoreOrderStatusEmail` para inspeccionar el disparo del mail;
 * el resto de `email.service` queda real (los envíos van dentro de try/catch).
 */
jest.mock('../../utils/email.service', () => {
  const actual = jest.requireActual('../../utils/email.service');
  return { ...actual, sendStoreOrderStatusEmail: jest.fn().mockResolvedValue(undefined) };
});

import { api, API, loginAdmin, auth, findPurchasable } from './helpers';
import { sendStoreOrderStatusEmail } from '../../utils/email.service';
import { StoreOrder } from '../../models';

const statusEmailMock = sendStoreOrderStatusEmail as jest.Mock;

/** Espera a que corra el `setImmediate` del despachador de mails. */
const flushQueue = () => new Promise((r) => setTimeout(r, 200));

async function createOrder() {
  const target = await findPurchasable();
  if (!target) return null;
  const res = await api()
    .post(`${API}/store/checkout`)
    .send({
      accept_terms: true,
      customerName: 'Robot Tracking',
      customerEmail: `track+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: target.id, size_name: target.size, quantity: 1 }],
      shipping_type: 'delivery',
      shipping_address: { street: 'Calle 1', city: 'CABA' },
      payment_method: 'bank_transfer',
    });
  expect(res.status).toBe(201);
  const order = res.body.data.order ?? res.body.data;
  return order as { id: number; order_number: string; tracking_token: string };
}

describe('Seguimiento de pedidos — API', () => {
  beforeEach(() => statusEmailMock.mockClear());

  it('cada cambio de estado desde admin encola el mail correcto', async () => {
    const order = await createOrder();
    if (!order) { console.warn('[store-tracking] Sin stock — test omitido.'); return; }
    const token = await loginAdmin();

    // pending_payment → processing (En preparación)
    const r1 = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(token))
      .send({ status: 'processing' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.email_queued).toBe(true);
    await flushQueue();
    expect(statusEmailMock.mock.calls.some((c) => c[0].status === 'processing')).toBe(true);

    // processing → shipped (En camino) con transportista + N° de seguimiento
    statusEmailMock.mockClear();
    const r2 = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(token))
      .send({ status: 'shipped', courier_name: 'Andreani', tracking_number: 'AR999' });
    expect(r2.status).toBe(200);
    await flushQueue();
    const shippedCall = statusEmailMock.mock.calls.find((c) => c[0].status === 'shipped');
    expect(shippedCall).toBeDefined();
    expect(shippedCall![0].courierName).toBe('Andreani');
    expect(shippedCall![0].trackingNumber).toBe('AR999');
  });

  it('marcar "En camino" sin datos de despacho es rechazado (400)', async () => {
    const order = await createOrder();
    if (!order) return;
    const token = await loginAdmin();
    // pending_payment → processing primero (shipped no es transición directa)
    await api().patch(`${API}/store/admin/orders/${order.id}/status`).set(...auth(token)).send({ status: 'processing' });
    const res = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(token))
      .send({ status: 'shipped' });
    expect(res.status).toBe(400);
  });

  it('el seguimiento por token válido devuelve la línea de tiempo', async () => {
    const order = await createOrder();
    if (!order) return;
    const res = await api().get(`${API}/store/track/${order.tracking_token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.order_number).toBe(order.order_number);
    expect(Array.isArray(res.body.data.timeline)).toBe(true);
    // No debe filtrar datos internos
    expect(res.body.data.total_amount).toBeUndefined();
    expect(res.body.data.customer_email).toBeUndefined();
    expect(res.body.data.tracking_token).toBeUndefined();
  });

  it('el seguimiento NO es accesible sin un token válido (404)', async () => {
    const res = await api().get(`${API}/store/track/token-inexistente-${Date.now()}`);
    expect(res.status).toBe(404);
  });

  it('un token vencido rechaza el acceso (410)', async () => {
    const order = await createOrder();
    if (!order) return;
    // Forzar vencimiento en el pasado
    await StoreOrder.update(
      { tracking_token_expires_at: new Date(Date.now() - 60_000) },
      { where: { id: order.id } }
    );
    const res = await api().get(`${API}/store/track/${order.tracking_token}`);
    expect(res.status).toBe(410);
  });
});
