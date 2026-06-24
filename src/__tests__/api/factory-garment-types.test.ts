import { api, API, loginAs, auth } from './helpers';

/*
 * Datos maestros: tipos de prenda, tipos de tela y talles (módulo master), y
 * categorías de catálogo. Alta y listado. Todos requieren rol admin (catálogo
 * también billing).
 */

describe('Tipos de prenda y categorías — API', () => {
  let admin: string;
  beforeAll(async () => { admin = await loginAs('admin'); });

  it('crea un tipo de prenda y aparece en el listado', async () => {
    const name = `Tipo QA ${Date.now()}`;
    const create = await api().post(`${API}/master/garment-types`).set(...auth(admin)).send({ name });
    expect(create.status).toBe(201);

    const list = await api().get(`${API}/master/garment-types`).set(...auth(admin));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((g: any) => g.name === name)).toBe(true);
  });

  it('crea un tipo de tela y un talle', async () => {
    const fabric = await api().post(`${API}/master/fabric-types`).set(...auth(admin)).send({ name: `Tela QA ${Date.now()}` });
    expect(fabric.status).toBe(201);
    const size = await api().post(`${API}/master/sizes`).set(...auth(admin)).send({ name: `T-${Date.now() % 1000}` });
    expect(size.status).toBe(201);
  });

  it('crea una categoría de catálogo y aparece en el listado', async () => {
    const name = `Categoría QA ${Date.now()}`;
    const create = await api().post(`${API}/catalog/categories`).set(...auth(admin)).send({ name });
    expect(create.status).toBe(201);

    const list = await api().get(`${API}/catalog/categories`).set(...auth(admin));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((c: any) => c.name === name)).toBe(true);
  });

  it('un tipo de prenda requiere nombre', async () => {
    const res = await api().post(`${API}/master/garment-types`).set(...auth(admin)).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
