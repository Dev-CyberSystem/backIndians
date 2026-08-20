import { api, API, loginAs, auth } from './helpers';
import * as mpService from '../../services/mercadopago.service';
import * as catalogService from '../../services/catalog.service';
import { reconcileCatalogPayments } from '../../jobs/reconcileCatalogPayments';
import { CatalogOrder } from '../../models/CatalogOrder';
import { CatalogInvoice } from '../../models/CatalogInvoice';
import { CatalogInvoicePayment } from '../../models/CatalogInvoicePayment';
import { getDashboardSummary } from '../../services/dashboard.service';

/*
 * Acreditación de pagos de MercadoPago en las ventas de catálogo (fix del
 * 2026-08-19).
 *
 * Antes de este fix, un pedido de catálogo pagado por QR o por link de pago
 * quedaba indistinguible de uno impago: el webhook sólo estampaba
 * `mp_payment_status` en el pedido y no registraba el cobro, así que la
 * factura seguía en $0 cobrado, no había asiento de caja y el dashboard
 * mostraba "Facturación catálogo: $0" / "Cobrado vía MercadoPago: $0".
 *
 * Los pagos se simulan con jest.spyOn sobre `mercadopago.service` (mismo
 * patrón que reconcile-payments.test.ts) — no se cobra nada real.
 */

describe('Pagos de MercadoPago en catálogo', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  const PRICE = 5000;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto QA pago MP ${Date.now()}`,
      price: PRICE,
      stock_quantity: 500,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Crea una venta de catálogo y devuelve el pedido con su factura recién emitida. */
  async function createSale(paymentType: 'full' | 'half' = 'full', quantity = 1) {
    const sale = await api().post(`${API}/catalog/orders`).set(...auth(admin)).send({
      client_id: clientId,
      payment_type: paymentType,
      items: [{ product_id: productId, quantity }],
    });
    expect(sale.status).toBe(201);
    const orderId = sale.body.data.id as number;
    const order = await CatalogOrder.findByPk(orderId);
    const invoice = await CatalogInvoice.findOne({ where: { catalog_order_id: orderId } });
    return { order: order!, invoice: invoice! };
  }

  function approvedPayment(orderNumber: string, amount: number, id: number): mpService.PaymentInfo {
    return {
      id,
      status: 'approved',
      external_reference: orderNumber,
      transaction_amount: amount,
      currency_id: 'ARS',
      date_approved: new Date().toISOString(),
      date_last_updated: new Date().toISOString(),
    };
  }

  it('un pago aprobado registra el cobro, salda la factura y estampa el estado de MP', async () => {
    const { order, invoice } = await createSale();
    const paymentId = Date.now();

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue(
      approvedPayment(order.order_number, PRICE, paymentId)
    );

    await catalogService.handleMPWebhook(String(paymentId));

    await invoice.reload();
    await order.reload();

    expect(invoice.status).toBe('paid');
    expect(invoice.payment_amount).toBe(PRICE);
    expect(order.mp_payment_status).toBe('approved');
    expect(order.mp_payment_id).toBe(String(paymentId));

    const payments = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].payment_method).toBe('mercadopago');
    expect(payments[0].amount).toBe(PRICE);
  });

  it('reprocesar el mismo pago no duplica el cobro (idempotencia)', async () => {
    const { order, invoice } = await createSale();
    const paymentId = Date.now() + 1;

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue(
      approvedPayment(order.order_number, PRICE, paymentId)
    );

    await catalogService.handleMPWebhook(String(paymentId));
    // MP reenvía la misma notificación (y el job de reconciliación también la
    // aplicaría): ninguna de las dos debe generar un segundo cobro.
    await catalogService.handleMPWebhook(String(paymentId));
    await catalogService.applyCatalogPaymentResult(
      order, approvedPayment(order.order_number, PRICE, paymentId), String(paymentId)
    );

    const payments = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id } });
    expect(payments).toHaveLength(1);

    await invoice.reload();
    expect(invoice.payment_amount).toBe(PRICE);
  });

  it('un pago parcial (payment_type=half) deja la factura emitida con saldo', async () => {
    const { order, invoice } = await createSale('half');
    const paymentId = Date.now() + 2;
    const half = PRICE / 2;

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue(
      approvedPayment(order.order_number, half, paymentId)
    );

    await catalogService.handleMPWebhook(String(paymentId));

    await invoice.reload();
    expect(invoice.payment_amount).toBe(half);
    expect(invoice.status).toBe('issued');
  });

  it('un pago no aprobado deja constancia del estado pero no acredita nada', async () => {
    const { order, invoice } = await createSale();
    const paymentId = Date.now() + 3;

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue({
      id: paymentId,
      status: 'rejected',
      external_reference: order.order_number,
      transaction_amount: PRICE,
      currency_id: 'ARS',
    });

    await catalogService.handleMPWebhook(String(paymentId));

    await order.reload();
    await invoice.reload();
    expect(order.mp_payment_status).toBe('rejected');
    expect(invoice.status).toBe('issued');
    expect(invoice.payment_amount).toBe(0);
    const payments = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id } });
    expect(payments).toHaveLength(0);
  });

  it('un pago en otra moneda no se acredita a ciegas', async () => {
    const { order, invoice } = await createSale();
    const paymentId = Date.now() + 4;

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue({
      id: paymentId,
      status: 'approved',
      external_reference: order.order_number,
      transaction_amount: PRICE,
      currency_id: 'USD',
    });

    await catalogService.handleMPWebhook(String(paymentId));

    await invoice.reload();
    expect(invoice.payment_amount).toBe(0);
    expect(invoice.status).toBe('issued');
  });

  it('un webhook de la tienda (referencia ECOM-) no toca el circuito de catálogo', async () => {
    const paymentId = Date.now() + 5;
    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue({
      id: paymentId,
      status: 'approved',
      external_reference: 'ECOM-2026-00001',
      transaction_amount: 1000,
      currency_id: 'ARS',
    });

    // No debe lanzar ni intentar imputar el pago a ningún pedido de catálogo.
    await expect(catalogService.handleMPWebhook(String(paymentId))).resolves.toBeUndefined();
  });

  it('el job de reconciliación acredita un pago que el webhook nunca trajo', async () => {
    const { order, invoice } = await createSale();
    const paymentId = Date.now() + 6;

    // El pedido tiene link de pago generado y quedó "viejo" (el job ignora los
    // recién creados, por la ventana de gracia).
    await CatalogOrder.update(
      { mp_preference_id: `pref-qa-${paymentId}`, createdAt: new Date(Date.now() - 60 * 60_000) },
      { where: { id: order.id }, silent: true }
    );

    jest.spyOn(mpService, 'searchPaymentsByReference').mockImplementation(async (ref: string) =>
      ref === order.order_number ? [approvedPayment(order.order_number, PRICE, paymentId)] : []
    );

    const result = await reconcileCatalogPayments();
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    await invoice.reload();
    expect(invoice.status).toBe('paid');
    expect(invoice.payment_amount).toBe(PRICE);
  });

  it('el dashboard cuenta lo facturado y lo cobrado por MercadoPago', async () => {
    const before = await getDashboardSummary();
    const { order } = await createSale();
    const paymentId = Date.now() + 7;

    jest.spyOn(mpService, 'getPaymentInfo').mockResolvedValue(
      approvedPayment(order.order_number, PRICE, paymentId)
    );
    await catalogService.handleMPWebhook(String(paymentId));

    const after = await getDashboardSummary();

    // Facturación: la factura emitida suma su total, se haya cobrado o no.
    expect(after.catalog.revenue_this_period).toBeCloseTo(
      before.catalog.revenue_this_period + PRICE, 2
    );
    // Cobrado vía MercadoPago: sube por el cobro efectivamente acreditado.
    expect(after.catalog.payment_breakdown.via_mp.amount).toBeCloseTo(
      before.catalog.payment_breakdown.via_mp.amount + PRICE, 2
    );
    expect(after.catalog.payment_breakdown.via_mp.count).toBe(
      before.catalog.payment_breakdown.via_mp.count + 1
    );
  });

  it('marcar la factura como pagada a mano ya no la deja fuera de la facturación', async () => {
    // Este es el caso concreto que reportó producción: la factura figuraba
    // "Pagada" en el listado y el dashboard mostraba $0 facturado, porque la
    // métrica sumaba `payment_amount` (que ese camino no toca).
    const before = await getDashboardSummary();
    const { order } = await createSale();

    const res = await api()
      .patch(`${API}/catalog/orders/${order.id}/invoice/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(res.status).toBe(200);

    const after = await getDashboardSummary();
    expect(after.catalog.revenue_this_period).toBeCloseTo(
      before.catalog.revenue_this_period + PRICE, 2
    );
  });

  it('una factura anulada no suma a la facturación del catálogo', async () => {
    const before = await getDashboardSummary();
    const { order } = await createSale();

    const res = await api()
      .patch(`${API}/catalog/orders/${order.id}/invoice/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);

    const after = await getDashboardSummary();
    expect(after.catalog.revenue_this_period).toBeCloseTo(before.catalog.revenue_this_period, 2);
  });
});
