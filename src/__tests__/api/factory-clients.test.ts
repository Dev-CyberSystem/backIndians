import { api, API, loginAs, auth } from './helpers';

/*
 * Clientes (instituciones/clubes para los que se fabrica). Alta, aparición en
 * el listado y validación de campos obligatorios.
 */

describe('Clientes — API', () => {
  let token: string;
  beforeAll(async () => { token = await loginAs('admin'); });

  it('crea un cliente nuevo y aparece en el listado', async () => {
    const name = `Club QA ${Date.now()}`;
    const create = await api().post(`${API}/clients`).set(...auth(token)).send({
      name,
      contact_name: 'Responsable QA',
      phone: '0351-1234567',
      email: `club.qa.${Date.now()}@test.local`,
      cuit: '30-71234567-8',
      address: 'Calle Falsa 123',
    });
    expect(create.status).toBe(201);
    const id = create.body.data?.id;
    expect(id).toBeTruthy();

    const list = await api().get(`${API}/clients`).set(...auth(token));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data ?? [];
    expect(rows.some((c: any) => c.id === id || c.name === name)).toBe(true);
  });

  it('rechaza crear un cliente sin nombre', async () => {
    const res = await api().post(`${API}/clients`).set(...auth(token)).send({ contact_name: 'Sin nombre' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('ventas (seller) también puede dar de alta clientes', async () => {
    const seller = await loginAs('seller');
    const res = await api().post(`${API}/clients`).set(...auth(seller)).send({ name: `Cliente Vendedor ${Date.now()}` });
    expect(res.status).toBe(201);
  });
});
