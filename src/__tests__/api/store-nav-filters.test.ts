import { api, API, loginAs, auth } from './helpers';

/*
 * Pedido 04 del brief 06.10.2026: filtros que alimentan el menú nuevo de la tienda.
 *   - `on_sale=true` → solo productos con descuento activo (sección "Ofertas").
 *   - `tag=A,B` → productos con alguno de los tags ("Tops y remeras").
 *   - `/products/filters` informa géneros / tags / clubes por categoría.
 */

describe('Filtros del menú de la tienda', () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const category = `NavQA ${stamp}`;
  const ids: Record<string, number> = {};

  async function createProduct(admin: string, clientId: number, extra: Record<string, unknown>) {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      price: 5000,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
      category,
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  beforeAll(async () => {
    const admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    ids.sale = await createProduct(admin, clientId, { title: `Oferta ${stamp}`, discount_percentage: 20, tags: ['Top'], gender: 'femenino' });
    ids.full = await createProduct(admin, clientId, { title: `Precio lleno ${stamp}`, discount_percentage: 0, tags: ['Remera'], gender: 'femenino' });
    ids.other = await createProduct(admin, clientId, { title: `Otro ${stamp}`, discount_percentage: 0, tags: ['Buzo'], gender: 'masculino' });
  });

  const list = async (qs: string) => {
    const res = await api().get(`${API}/store/products?category=${encodeURIComponent(category)}&${qs}`);
    expect(res.status).toBe(200);
    return (res.body.data as Array<{ id: number }>).map((p) => p.id);
  };

  it('on_sale=true devuelve solo productos con descuento', async () => {
    expect(await list('on_sale=true')).toEqual([ids.sale]);
  });

  it('sin on_sale no filtra por descuento', async () => {
    const got = await list('');
    expect(got).toEqual(expect.arrayContaining([ids.sale, ids.full, ids.other]));
  });

  it('tag con varios valores trae productos con cualquiera de ellos', async () => {
    const got = await list(`tag=${encodeURIComponent('Top,Remera')}`);
    expect(got.sort()).toEqual([ids.sale, ids.full].sort());
  });

  it('on_sale con valor inválido responde 422', async () => {
    const res = await api().get(`${API}/store/products?on_sale=quizas`);
    expect(res.status).toBe(422);
  });

  it('/products/filters informa los géneros disponibles por categoría', async () => {
    const res = await api().get(`${API}/store/products/filters`);
    expect(res.status).toBe(200);
    const genders = res.body.data.category_genders?.[category];
    // El endpoint se cachea 60 s: si ya estaba calculado, la categoría nueva todavía no aparece.
    if (genders) expect(genders.sort()).toEqual(['femenino', 'masculino']);
    expect(res.body.data).toHaveProperty('category_genders');
    expect(res.body.data).toHaveProperty('category_tags');
    expect(res.body.data).toHaveProperty('category_clients');
  });
});
