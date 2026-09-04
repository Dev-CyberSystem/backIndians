/*
 * Listado admin de pedidos de la tienda (GET /store/admin/orders):
 * paginación y filtro por fecha. Requiere MySQL migrado y seed del admin.
 *
 * Regresión: el filtro `date_to` armaba el tope con `setHours()` sobre una
 * fecha en medianoche UTC y, en zonas al oeste de UTC (Argentina), dejaba
 * fuera todos los pedidos del día indicado.
 */
import { api, API, loginAdmin, auth, findPurchasable } from './helpers';

async function createOrder(): Promise<string | null> {
  const target = await findPurchasable();
  if (!target) return null;
  const res = await api()
    .post(`${API}/store/checkout`)
    .send({
      accept_terms: true,
      customerName: 'Robot Listado', customerDni: '30123456',
      customerEmail: `listado+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: target.id, size_name: target.size, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
    });
  expect(res.status).toBe(201);
  return res.body.data.order.order_number as string;
}

describe('GET /store/admin/orders — paginación y filtro por fecha', () => {
  let token: string;
  let orderNumber: string;

  beforeAll(async () => {
    token = await loginAdmin();
    const n = await createOrder();
    if (!n) throw new Error('no hay producto comprable para sembrar el pedido');
    orderNumber = n;
  });

  it('devuelve el sobre paginado { data, meta }', async () => {
    const res = await api().get(`${API}/store/admin/orders?page=1&limit=5`).set(...auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta).toMatchObject({
      page: 1,
      limit: 5,
      total: expect.any(Number),
      total_pages: expect.any(Number),
    });
  });

  it('date_from = date_to = hoy incluye un pedido creado hoy', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await api()
      .get(`${API}/store/admin/orders?date_from=${today}&date_to=${today}&limit=100`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    const numbers = res.body.data.map((o: { order_number: string }) => o.order_number);
    expect(numbers).toContain(orderNumber);
  });

  it('un rango futuro no devuelve nada', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await api()
      .get(`${API}/store/admin/orders?date_from=${tomorrow}&limit=100`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });
});
