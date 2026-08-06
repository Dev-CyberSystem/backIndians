import { api, API, loginAs, auth } from './helpers';
import { CashTransaction } from '../../models/CashTransaction';

/*
 * Reversión automática de caja en cancelaciones y devoluciones de tienda
 * (Fase 4 del plan de corrección — cierra CASH-SALE-002: hoy cancelar un
 * pedido pagado, o registrar una devolución, no revertía el ingreso de caja
 * ya registrado por `recordStoreOrderIncome`).
 *
 * Cubre: cancelación total (contraasiento por el total, saldo vuelve al
 * valor previo a la venta), devolución parcial (contraasiento por
 * `refunded_amount`, no por el total), dos devoluciones parciales sobre el
 * mismo pedido (dos contraasientos, ninguno omitido — la razón de que la
 * marca de idempotencia viva en `store_returns` y no solo en `store_orders`),
 * y el caso "no hace nada" cuando nunca hubo ingreso registrado.
 */

describe('Reversión automática de caja en cancelaciones/devoluciones — Fase 4', () => {
  let admin: string;
  let clientId: number;
  let cashAccountId: number;
  let originalCashAccountSetting: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const cashAcc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja QA Fase4 ${Date.now()}`, type: 'cash' });
    cashAccountId = cashAcc.body.data.id;

    const currentSettings = await api().get(`${API}/settings`).set(...auth(admin));
    originalCashAccountSetting = currentSettings.body.data?.store_cash_account_id;

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(cashAccountId),
    });
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: originalCashAccountSetting ?? '',
    });
  });

  async function accountBalance(id: number): Promise<number> {
    const res = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    const acc = (res.body.data as Array<{ id: number; current_balance: string }>).find((a) => a.id === id);
    return Number(acc!.current_balance);
  }

  async function createPaidOrder(
    price: number,
    label: string,
    quantity = 1
  ): Promise<{ orderId: number; orderNumber: string; orderItemId: number; total: number }> {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Fase4 QA ${label} ${Date.now()}-${Math.random()}`,
      price,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    const productId = product.body.data.id;

    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: `Robot QA Fase4 ${label}`,
      customerEmail: `qa-fase4-${label.toLowerCase().replace(/\s+/g, '-')}+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    const markPaid = await api().patch(`${API}/store/admin/orders/${order.id}/status`).set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200);

    const detail = await api().get(`${API}/store/admin/orders/${order.id}`).set(...auth(admin));
    const orderItemId = detail.body.data.items[0].id;

    return { orderId: order.id, orderNumber: order.order_number, orderItemId, total: Number(order.total_amount) };
  }

  // ── Cancelación ────────────────────────────────────────────────────────────

  it('cancelar un pedido pagado revierte el ingreso por el total — el saldo vuelve al valor previo a la venta', async () => {
    const before = await accountBalance(cashAccountId);
    const { orderId, total } = await createPaidOrder(4000, 'Cancelacion');
    expect(await accountBalance(cashAccountId)).toBe(before + total);

    const cancel = await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    expect(await accountBalance(cashAccountId)).toBe(before); // vuelve exacto al valor previo a la venta

    const original = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: orderId, reversal_of_id: null },
    });
    expect(original!.status).toBe('reversed');

    const reversal = await CashTransaction.findOne({
      where: { reversal_of_id: original!.id },
    });
    expect(reversal).not.toBeNull();
    expect(reversal!.type).toBe('expense');
    expect(Number(reversal!.amount)).toBe(total);
  });

  it('cancelar un pedido pagado dos veces (reintento) no duplica el contraasiento — idempotente por cash_reversed_at', async () => {
    const { orderId, total } = await createPaidOrder(2500, 'CancelacionDoble');
    const before = await accountBalance(cashAccountId);

    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'cancelled' });
    expect(await accountBalance(cashAccountId)).toBe(before - total);

    // Reintento del mismo cambio de estado (statusChanged=false, no debería tocar nada de nuevo).
    const retry = await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(retry.status).toBe(200);
    expect(await accountBalance(cashAccountId)).toBe(before - total); // sin cambios

    const reversals = await CashTransaction.count({
      where: {
        reversal_of_id: (await CashTransaction.findOne({
          where: { reference_type: 'store_order', reference_id: orderId, reversal_of_id: null },
        }))!.id,
      },
    });
    expect(reversals).toBe(1);
  });

  it('cancelar un pedido que nunca se pagó no hace nada — no falla, no crea contraasiento', async () => {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId, title: `Producto Fase4 Sin Pagar ${Date.now()}`, price: 1000,
      stock_quantity: 5, show_in_store: true, active: true,
    });
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Fase4 Sin Pagar',
      customerEmail: `qa-fase4-sinpagar+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: product.body.data.id, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    const orderId = checkout.body.data.order.id;

    const cancel = await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    const tx = await CashTransaction.findOne({ where: { reference_type: 'store_order', reference_id: orderId } });
    expect(tx).toBeNull();
  });

  // ── Devoluciones ───────────────────────────────────────────────────────────

  async function deliverOrder(orderId: number): Promise<void> {
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'processing' });
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({
      status: 'shipped', tracking_number: 'QA-F4', courier_name: 'Correo QA',
    });
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'delivered' });
  }

  it('una devolución marcada como reintegrada revierte solo el monto devuelto (parcial), no el total', async () => {
    const before = await accountBalance(cashAccountId);
    const { orderId, orderItemId, total } = await createPaidOrder(10000, 'DevolucionParcial');
    await deliverOrder(orderId);
    expect(await accountBalance(cashAccountId)).toBe(before + total);

    const created = await api().post(`${API}/store/admin/orders/${orderId}/returns`).set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;

    const refund = await api().patch(`${API}/store/admin/returns/${returnId}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 3000 }); // parcial, no el total de 10000
    expect(refund.status).toBe(200);

    expect(await accountBalance(cashAccountId)).toBe(before + total - 3000);

    const original = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: orderId, reversal_of_id: null },
    });
    expect(original!.status).toBe('active'); // sigue activo — no se revirtió por completo

    const reversal = await CashTransaction.findOne({ where: { reversal_of_id: original!.id } });
    expect(Number(reversal!.amount)).toBe(3000);
  });

  it('dos devoluciones parciales sobre el mismo pedido generan dos contraasientos, ninguno omitido', async () => {
    const before = await accountBalance(cashAccountId);
    // Compra 2 unidades para poder devolver en dos tandas separadas (dos StoreReturn distintos).
    const { orderId, orderItemId, total } = await createPaidOrder(4500, 'DosDevoluciones', 2);
    await deliverOrder(orderId);
    expect(await accountBalance(cashAccountId)).toBe(before + total); // total = 9000 (2 x 4500)

    const created1 = await api().post(`${API}/store/admin/orders/${orderId}/returns`).set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    expect(created1.status).toBe(201);
    const returnId1 = created1.body.data.id;

    const refund1 = await api().patch(`${API}/store/admin/returns/${returnId1}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 2000 });
    expect(refund1.status).toBe(200);
    expect(await accountBalance(cashAccountId)).toBe(before + total - 2000);

    // `createStoreReturn` solo acepta pedidos en 'delivered' — tras la primera devolución
    // el pedido quedó en 'returned'. El propio flujo de estados permite reingresar a
    // 'delivered' (returned → processing → shipped → delivered), habilitando una segunda
    // devolución independiente sobre el mismo pedido.
    await deliverOrder(orderId);

    const created2 = await api().post(`${API}/store/admin/orders/${orderId}/returns`).set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    expect(created2.status).toBe(201);
    const returnId2 = created2.body.data.id;

    const refund2 = await api().patch(`${API}/store/admin/returns/${returnId2}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 1500 });
    expect(refund2.status).toBe(200);

    expect(await accountBalance(cashAccountId)).toBe(before + total - 2000 - 1500);

    const original = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: orderId, reversal_of_id: null },
    });
    const reversalCount = await CashTransaction.count({ where: { reversal_of_id: original!.id } });
    expect(reversalCount).toBe(2); // ninguna de las dos devoluciones se salteó
  });

  it('un segundo reintegro sobre la MISMA devolución no duplica el contraasiento — idempotente por cash_reversed_at de la devolución', async () => {
    const before = await accountBalance(cashAccountId);
    const { orderId, orderItemId, total } = await createPaidOrder(6000, 'ReintegroDoble');
    await deliverOrder(orderId);

    const created = await api().post(`${API}/store/admin/orders/${orderId}/returns`).set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;

    await api().patch(`${API}/store/admin/returns/${returnId}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 6000 });
    expect(await accountBalance(cashAccountId)).toBe(before + total - 6000);

    // Reintento (p. ej. doble click del admin) con el mismo refund_status.
    const retry = await api().patch(`${API}/store/admin/returns/${returnId}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 6000 });
    expect(retry.status).toBe(200);
    expect(await accountBalance(cashAccountId)).toBe(before + total - 6000); // sin cambios

    const original = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: orderId, reversal_of_id: null },
    });
    const reversalCount = await CashTransaction.count({ where: { reversal_of_id: original!.id } });
    expect(reversalCount).toBe(1);
  });

  it('el monto reintegrado es obligatorio para marcar el reintegro como realizado', async () => {
    const { orderId, orderItemId } = await createPaidOrder(3000, 'SinMonto');
    await deliverOrder(orderId);

    const created = await api().post(`${API}/store/admin/orders/${orderId}/returns`).set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;

    const res = await api().patch(`${API}/store/admin/returns/${returnId}/refund`).set(...auth(admin))
      .send({ refund_status: 'refunded' }); // sin refunded_amount
    expect(res.status).toBe(400);
  });
});
