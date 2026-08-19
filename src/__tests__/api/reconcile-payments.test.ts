import { api, API, findPurchasable } from './helpers';
import * as mpService from '../../services/mercadopago.service';
import { reconcilePendingPayments } from '../../jobs/reconcilePayments';
import { reportDailyInconsistencies } from '../../jobs/reportInconsistencies';
import { StoreOrder } from '../../models/StoreOrder';

/*
 * Job de reconciliación de pagos (1.8 / C-8 parcial). Simula respuestas de
 * MercadoPago con jest.spyOn sobre searchPaymentsByReference (mismo patrón
 * que webhook-robustness.test.ts) para no depender de pagos reales.
 */

describe('Job de reconciliación de pagos — 1.8', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createStaleMercadopagoOrder(minutesOld: number): Promise<{ orderId: number; orderNumber: string; total: number }> {
    const target = await findPurchasable();
    if (!target) throw new Error('Sin productos con stock — corré "npm run seed".');

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Reconcile',
      customerEmail: `qa-reconcile+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: target.id, size_name: target.size, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'mercadopago',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order;

    // Backdatear createdAt para simular que el pedido quedó pending_payment
    // hace rato (el job solo reconsulta pedidos con más de N minutos).
    const oldDate = new Date(Date.now() - minutesOld * 60_000);
    await StoreOrder.update({ createdAt: oldDate }, { where: { id: order.id }, silent: true });

    return { orderId: order.id, orderNumber: order.order_number, total: order.total_amount };
  }

  it('un pedido pending_payment viejo con pago ya aprobado en MP se acredita solo', async () => {
    const { orderId, orderNumber, total } = await createStaleMercadopagoOrder(10);

    jest.spyOn(mpService, 'searchPaymentsByReference').mockResolvedValue([{
      id: 999, status: 'approved', external_reference: orderNumber,
      transaction_amount: total, currency_id: 'ARS',
      date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString(),
    }]);

    const result = await reconcilePendingPayments();
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('paid');
  });

  it('un pedido pending_payment recién creado (dentro de la ventana de gracia) no se toca', async () => {
    const { orderId, orderNumber, total } = await createStaleMercadopagoOrder(0); // recién creado

    const spy = jest.spyOn(mpService, 'searchPaymentsByReference').mockResolvedValue([{
      id: 998, status: 'approved', external_reference: orderNumber,
      transaction_amount: total, currency_id: 'ARS',
      date_last_updated: new Date().toISOString(),
    }]);

    await reconcilePendingPayments();

    // No debería haberse llamado a MP para este pedido (todavía está "fresco").
    const calledForThisOrder = spy.mock.calls.some(([ref]) => ref === orderNumber);
    expect(calledForThisOrder).toBe(false);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('pending_payment'); // sin cambios
  });

  it('el reporte diario detecta un pedido cancelado sin restituir stock', async () => {
    const { orderId } = await createStaleMercadopagoOrder(20);
    // Fuerza el estado inconsistente directo en la base (nunca debería pasar
    // por el flujo normal — es exactamente lo que este job tiene que cazar).
    await StoreOrder.update(
      { status: 'cancelled', stock_restored_at: null },
      { where: { id: orderId } }
    );

    const result = await reportDailyInconsistencies();
    expect(result.cancelledWithoutRestock).toBeGreaterThanOrEqual(1);
  });
});
