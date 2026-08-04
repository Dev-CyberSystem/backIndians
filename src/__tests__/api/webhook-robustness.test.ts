import { api, API, loginAs, auth } from './helpers';
import * as mpService from '../../services/mercadopago.service';
import { handleStoreWebhook } from '../../services/store.service';
import { WebhookEvent } from '../../models/WebhookEvent';
import { StoreOrder } from '../../models/StoreOrder';
import { logger } from '../../utils/logger';

/*
 * Robustez de webhooks (1.5 / A-7, casos 13/14/15 de la auditoría). Simula
 * respuestas de MercadoPago con jest.spyOn sobre getPaymentInfo (no hay
 * mock del SDK en el repo todavía) para no depender de pagos reales.
 * Crea pedidos propios en efectivo y les aplica un webhook simulado —
 * handleStoreWebhook no distingue el payment_method original del pedido.
 */

describe('Robustez de webhooks de MercadoPago — 1.5', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Webhook QA ${Date.now()}`,
      price: 5000,
      stock_quantity: 20,
      show_in_store: true,
      active: true,
    });
    productId = product.body.data?.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createOrder(quantity = 1): Promise<{ orderId: number; orderNumber: string; total: number }> {
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Webhook',
      customerEmail: `qa-webhook+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order;
    return { orderId: order.id, orderNumber: order.order_number, total: order.total_amount };
  }

  it('caso 13 — webhook repetido (mismo payment_id) es idempotente: no reconsulta MP ni duplica el evento', async () => {
    const { orderId, orderNumber, total } = await createOrder(1);
    const paymentId = `qa-${Date.now()}`;

    const spy = jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue({
      id: 1, status: 'approved', external_reference: orderNumber,
      transaction_amount: total, currency_id: 'ARS',
      date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString(),
    });

    await handleStoreWebhook(paymentId);
    await handleStoreWebhook(paymentId); // repetido

    expect(spy).toHaveBeenCalledTimes(1); // el segundo ni siquiera consulta a MP

    const events = await WebhookEvent.count({ where: { provider: 'mercadopago', event_id: paymentId } });
    expect(events).toBe(1);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('paid');
  });

  it('caso 14 — webhook con importe incorrecto no acredita: el pedido queda en revisión', async () => {
    const { orderId, orderNumber, total } = await createOrder(1);
    const paymentId = `qa-${Date.now()}`;

    const errorSpy = jest.spyOn(logger, 'error');
    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue({
      id: 2, status: 'approved', external_reference: orderNumber,
      transaction_amount: total + 5000, // no coincide
      currency_id: 'ARS',
      date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString(),
    });

    await handleStoreWebhook(paymentId);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('review'); // NO 'paid'
    expect(errorSpy).toHaveBeenCalledWith(
      'store.webhook.amountMismatch',
      expect.anything(),
      expect.anything()
    );

    const event = await WebhookEvent.findOne({ where: { provider: 'mercadopago', event_id: paymentId } });
    expect(event!.processed_at).not.toBeNull();
    expect(event!.result).toBe('applied');
  });

  it('caso 15 (parcial) / evento desordenado — un pending que llega después de un approved ya aplicado no retrocede el pedido', async () => {
    const { orderId, orderNumber, total } = await createOrder(1);
    const uniq = `${Date.now()}-${Math.random()}`;

    const approvedAt = new Date('2026-01-01T12:00:00Z');
    const pendingAt = new Date('2026-01-01T10:00:00Z'); // más viejo que el approved

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValueOnce({
      id: 3, status: 'approved', external_reference: orderNumber,
      transaction_amount: total, currency_id: 'ARS',
      date_approved: approvedAt.toISOString(), date_last_updated: approvedAt.toISOString(),
    });
    await handleStoreWebhook(`qa-approved-primero-${uniq}`);

    let order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('paid');

    // Evento distinto (otro payment_id), pero con fecha ANTERIOR al ya aplicado
    // — simula una notificación "pending" desordenada llegando tarde.
    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValueOnce({
      id: 4, status: 'pending', external_reference: orderNumber,
      transaction_amount: total, currency_id: 'ARS',
      date_last_updated: pendingAt.toISOString(),
    });
    await handleStoreWebhook(`qa-pending-desordenado-${uniq}`);

    order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('paid'); // no retrocedió a pending_payment
  });
});
