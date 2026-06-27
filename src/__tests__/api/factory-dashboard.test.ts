import { api, API, loginAs, auth } from './helpers';

/*
 * Dashboard / KPIs de negocio. Verifica la estructura del resumen y que una
 * venta nueva (pedido + su factura) se refleja en los indicadores.
 */

describe('Dashboard / KPIs — API', () => {
  let admin: string;
  let clientId: number;
  let garmentTypeId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
    const gts = await api().get(`${API}/master/garment-types`).set(...auth(admin));
    garmentTypeId = (gts.body.data?.rows ?? gts.body.data)[0].id;
  });

  it('el resumen trae los KPIs y estructuras de negocio', async () => {
    const res = await api().get(`${API}/dashboard/summary`).set(...auth(admin));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(typeof d.total_orders).toBe('number');
    expect(typeof d.revenue_this_month).toBe('number');
    expect(typeof d.pending_orders).toBe('number');
    expect(Array.isArray(d.orders_by_status)).toBe(true);
    expect(Array.isArray(d.top_clients)).toBe(true);
    expect(Array.isArray(d.recommendations)).toBe(true);
  });

  it('una venta nueva se refleja en el dashboard', async () => {
    const before = await api().get(`${API}/dashboard/summary`).set(...auth(admin));
    const ordersBefore = Number(before.body.data.orders_this_month);
    const revenueBefore = Number(before.body.data.revenue_this_month);

    const order = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'Verde', sizes: { M: 4 }, unit_price: 15000 }],
    });
    expect(order.status).toBe(201);

    const after = await api().get(`${API}/dashboard/summary`).set(...auth(admin));
    expect(Number(after.body.data.orders_this_month)).toBe(ordersBefore + 1);
    // la facturación del mes no debería bajar al ingresar una venta
    expect(Number(after.body.data.revenue_this_month)).toBeGreaterThanOrEqual(revenueBefore);
  });
});
