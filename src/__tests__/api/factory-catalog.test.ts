import { api, API, loginAs, auth } from './helpers';

/*
 * Catálogo: alta de productos de catálogo (por cliente) y ventas de catálogo.
 * Las categorías de catálogo se prueban en factory-garment-types.
 */

describe('Catálogo y ventas — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  it('crea un producto de catálogo y aparece en el listado', async () => {
    const title = `Producto Catálogo QA ${Date.now()}`;
    const create = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title,
      price: 8000,
      stock_quantity: 100,
    });
    expect(create.status).toBe(201);
    productId = create.body.data?.id;
    expect(productId).toBeTruthy();

    const list = await api().get(`${API}/catalog/products`).set(...auth(admin));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((p: any) => p.id === productId)).toBe(true);
  });

  it('registra una venta de catálogo con ese producto', async () => {
    const sale = await api().post(`${API}/catalog/orders`).set(...auth(admin)).send({
      client_id: clientId,
      payment_type: 'full',
      items: [{ product_id: productId, quantity: 2 }],
    });
    expect(sale.status).toBe(201);
    const saleId = sale.body.data?.id;
    expect(saleId).toBeTruthy();

    const list = await api().get(`${API}/catalog/orders`).set(...auth(admin));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((o: any) => o.id === saleId)).toBe(true);
  });

  it('el taller no puede crear productos de catálogo', async () => {
    const workshop = await loginAs('workshop');
    const res = await api().post(`${API}/catalog/products`).set(...auth(workshop))
      .send({ client_id: clientId, title: 'X', price: 1 });
    expect([401, 403]).toContain(res.status);
  });
});
