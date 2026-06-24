import { api, API, loginAs, auth } from './helpers';

/*
 * Prendas base (productos fabricables del catálogo interno). Alta, edición,
 * listado y validación. Crear/editar/borrar es solo de admin.
 */

describe('Prendas (productos base) — API', () => {
  let admin: string;
  beforeAll(async () => { admin = await loginAs('admin'); });

  it('da de alta una prenda y aparece en el listado', async () => {
    const name = `Prenda QA ${Date.now()}`;
    const create = await api().post(`${API}/products`).set(...auth(admin))
      .send({ name, base_price: 12500, category: 'Indumentaria', description: 'Prenda de prueba' });
    expect(create.status).toBe(201);
    const id = create.body.data?.id;
    expect(id).toBeTruthy();

    const list = await api().get(`${API}/products`).set(...auth(admin));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((p: any) => p.id === id)).toBe(true);
  });

  it('edita el precio de una prenda', async () => {
    const create = await api().post(`${API}/products`).set(...auth(admin))
      .send({ name: `Prenda Edit ${Date.now()}`, base_price: 1000, category: 'Test' });
    const id = create.body.data.id;

    const upd = await api().put(`${API}/products/${id}`).set(...auth(admin)).send({ base_price: 2000 });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.data?.base_price)).toBe(2000);
  });

  it('una prenda requiere nombre', async () => {
    const res = await api().post(`${API}/products`).set(...auth(admin)).send({ base_price: 999 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
