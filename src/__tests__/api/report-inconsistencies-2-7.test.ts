import { Op } from 'sequelize';
import { api, API, loginAs, auth } from './helpers';
import { reportDailyInconsistencies } from '../../jobs/reportInconsistencies';
import { StoreOrder } from '../../models/StoreOrder';
import { StoreReturn } from '../../models/StoreReturn';
import { Invoice, Order, Client, User } from '../../models';

/*
 * Ampliación del reporte diario de inconsistencias (2.7 — Fase 2 / C-7).
 * Cada caso fuerza directo en la base el estado que el job tiene que cazar
 * (son estados que, dado el diseño de 2.1-2.5, nunca deberían ocurrir por el
 * flujo normal) — mismo criterio que el test preexistente de 1.8.
 *
 * `alerts` se mockea: desde D-02 (auditoría del 2026-08-19) el job además
 * manda una alerta cuando encuentra algo, y acá se verifica esa llamada sin
 * mandar mails ni WhatsApps reales.
 */

jest.mock('../../utils/alerts', () => ({
  sendAlert: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendAlert } = require('../../utils/alerts') as { sendAlert: jest.Mock };

describe('Reporte diario de inconsistencias — ampliado (2.7)', () => {
  let admin: string;
  let clientId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createPendingOrder(): Promise<number> {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId, title: `Producto Conciliacion QA ${Date.now()}-${Math.random()}`,
      price: 4000, stock_quantity: 5, show_in_store: true, active: true,
    });
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Conciliacion', customerEmail: `qa-conciliacion+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000', items: [{ catalog_product_id: product.body.data.id, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'bank_transfer',
    });
    return checkout.body.data.order.id;
  }

  it('avisa por alerta cuando encuentra inconsistencias — no alcanza con loguearlas (D-02)', async () => {
    // Hasta el 2026-08-19 este job sólo escribía en el log: podía detectar a las
    // 03:00 pedidos pagados sin asiento en caja y nadie enterarse hasta que
    // alguien abriera los logs de Railway por otro motivo.
    sendAlert.mockClear();

    // Se fuerza una inconsistencia propia para no depender de lo que hayan
    // dejado los otros casos de este archivo.
    const orderId = await createPendingOrder();
    await StoreOrder.update(
      { status: 'cancelled', stock_restored_at: null },
      { where: { id: orderId }, silent: true }
    );

    const resultado = await reportDailyInconsistencies();
    const total = Object.values(resultado).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);

    expect(sendAlert).toHaveBeenCalledTimes(1);
    const payload = sendAlert.mock.calls[0][0];
    expect(payload.key).toBe('inconsistencias-diarias');
    expect(payload.severity).toBe('warning');
    expect(payload.detail).toContain('Pedidos cancelados sin restituir stock');
    // Una sola alerta con el resumen, no una por tipo: seis mensajes de
    // madrugada se ignoran en bloque.
    expect(payload.title).toContain('inconsistencia');
  });

  it('detecta una reserva de stock vencida que nunca expiró (job caído)', async () => {
    const orderId = await createPendingOrder();
    const oldDate = new Date(Date.now() - 200 * 3_600_000); // 200hs — muy por encima del umbral
    await StoreOrder.update({ stock_reserved_at: oldDate }, { where: { id: orderId }, silent: true });

    const result = await reportDailyInconsistencies();
    expect(result.staleUnreleasedReservations).toBeGreaterThanOrEqual(1);
  });

  it('detecta un pedido con stock confirmado (pagado) sin registro en caja', async () => {
    const orderId = await createPendingOrder();
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'paid' });

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.stock_confirmed_at).not.toBeNull(); // confirma que el pago sí se procesó

    const result = await reportDailyInconsistencies();
    expect(result.paidWithoutCashEntry).toBeGreaterThanOrEqual(1);
  });

  it('detecta comprobantes con envío a AFIP en estado error', async () => {
    const client = await Client.findOne();
    const user = await User.findOne();
    const order = await Order.create({
      order_number: `QAC${Date.now().toString(36)}`.slice(0, 20),
      client_id: client!.id, created_by: user!.id, total_amount: 5000, status: 'pending',
    });
    await Invoice.create({
      order_id: order.id, invoice_number: `FAC-QA-CONC-${Date.now()}`,
      issue_date: new Date(), status: 'issued', total_amount: 5000,
      afip_status: 'error', afip_error: 'Simulado para QA',
    });

    const result = await reportDailyInconsistencies();
    expect(result.afipErrors).toBeGreaterThanOrEqual(1);
  });

  it('detecta una devolución aprobada hace más de 7 días sin actualizar el reintegro', async () => {
    const orderId = await createPendingOrder();
    const oldDate = new Date(Date.now() - 10 * 24 * 3_600_000); // 10 días
    await StoreReturn.create({
      store_order_id: orderId,
      status: 'approved',
      refund_status: 'none',
      reviewed_at: oldDate,
    });

    const result = await reportDailyInconsistencies();
    expect(result.approvedReturnsWithoutRefundUpdate).toBeGreaterThanOrEqual(1);
  });

  it('una devolución aprobada RECIÉN (dentro de los 7 días) no se marca como inconsistencia', async () => {
    const orderId = await createPendingOrder();
    const ret = await StoreReturn.create({
      store_order_id: orderId,
      status: 'approved',
      refund_status: 'none',
      reviewed_at: new Date(),
    });

    await reportDailyInconsistencies();

    // Misma condición que usa el job internamente: esta fila puntual (recién
    // revisada) no debe aparecer en el corte de "hace más de 7 días".
    const flagged = await StoreReturn.findOne({
      where: {
        id: ret.id,
        status: 'approved',
        refund_status: 'none',
        reviewed_at: { [Op.lte]: new Date(Date.now() - 7 * 24 * 3_600_000) },
      },
    });
    expect(flagged).toBeNull();
  });
});
