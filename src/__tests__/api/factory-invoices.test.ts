import { api, API, loginAs, auth } from './helpers';

/*
 * Facturación. Al crear un pedido se genera automáticamente una factura (draft).
 * Se verifica el total, el registro de pagos (parcial y total) y que solo
 * admin/facturación puedan registrar pagos.
 */

describe('Facturas — API', () => {
  let admin: string;
  let clientId: number;
  let garmentTypeId: number;
  let orderId: number;
  let invoiceId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
    const gts = await api().get(`${API}/master/garment-types`).set(...auth(admin));
    garmentTypeId = (gts.body.data?.rows ?? gts.body.data)[0].id;

    // 8 unidades × 10000 = 80000 de total
    const order = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'Rojo', sizes: { M: 5, L: 3 }, unit_price: 10000 }],
    });
    orderId = order.body.data.id;
  });

  it('el pedido genera una factura automática con el total correcto', async () => {
    const res = await api().get(`${API}/invoices/by-order/${orderId}`).set(...auth(admin));
    expect(res.status).toBe(200);
    const inv = Array.isArray(res.body.data) ? res.body.data[0] : res.body.data;
    expect(inv?.id).toBeTruthy();
    expect(Number(inv.total_amount)).toBe(80000);
    invoiceId = inv.id;
  });

  it('registra un pago parcial y luego completa el total', async () => {
    const partial = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
      .send({ amount: 30000, notes: 'Seña' });
    expect(partial.status).toBeGreaterThanOrEqual(200);
    expect(partial.status).toBeLessThan(300);

    let inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
    expect(Number(inv.body.data?.payment_amount)).toBe(30000);

    const rest = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
      .send({ amount: 50000, notes: 'Saldo' });
    expect(rest.status).toBeGreaterThanOrEqual(200);
    expect(rest.status).toBeLessThan(300);

    inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
    expect(Number(inv.body.data?.payment_amount)).toBe(80000);
  });

  it('un vendedor no puede registrar pagos', async () => {
    const seller = await loginAs('seller');
    const res = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(seller))
      .send({ amount: 1000 });
    expect([401, 403]).toContain(res.status);
  });
});
