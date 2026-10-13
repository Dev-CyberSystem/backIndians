import { api, API, loginAs, auth, findPurchasable, asProductList } from './helpers';

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

    // Usamos el buscador del listado para no depender de la paginación
    // (la DB puede tener muchos clientes de pruebas anteriores).
    const list = await api().get(`${API}/clients?search=${encodeURIComponent(name)}`).set(...auth(token));
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

  describe('archivar / eliminar', () => {
    const newClient = async (t: string) => {
      const res = await api().post(`${API}/clients`).set(...auth(t))
        .send({ name: `Cliente Baja ${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
      expect(res.status).toBe(201);
      return res.body.data.id as number;
    };
    const inList = async (t: string, id: number, status?: string) => {
      const q = status ? `&status=${status}` : '';
      const res = await api().get(`${API}/clients?limit=100&search=Cliente%20Baja${q}`).set(...auth(t));
      return (res.body.data as Array<{ id: number }>).some((c) => c.id === id);
    };

    it('archiva: sale del listado por defecto, aparece en archivados y se puede reactivar', async () => {
      const id = await newClient(token);
      expect((await api().patch(`${API}/clients/${id}/archive`).set(...auth(token))).status).toBe(200);
      expect(await inList(token, id)).toBe(false);
      expect(await inList(token, id, 'archived')).toBe(true);
      expect(await inList(token, id, 'all')).toBe(true);
      // archivar dos veces → 409
      expect((await api().patch(`${API}/clients/${id}/archive`).set(...auth(token))).status).toBe(409);
      expect((await api().patch(`${API}/clients/${id}/restore`).set(...auth(token))).status).toBe(200);
      expect(await inList(token, id)).toBe(true);
    });

    it('un cliente archivado no admite pedidos de catálogo nuevos', async () => {
      const id = await newClient(token);
      await api().patch(`${API}/clients/${id}/archive`).set(...auth(token));
      const res = await api().post(`${API}/catalog/products`).set(...auth(token))
        .send({ client_id: id, title: 'Producto QA', price: 100 });
      expect([409, 422]).toContain(res.status);
    });

    it('PUT no puede archivar ni reactivar por mass assignment', async () => {
      const id = await newClient(token);
      await api().put(`${API}/clients/${id}`).set(...auth(token)).send({ active: false });
      expect(await inList(token, id)).toBe(true);
    });

    it('elimina físicamente un cliente sin datos asociados', async () => {
      const id = await newClient(token);
      const deps = await api().get(`${API}/clients/${id}/dependencies`).set(...auth(token));
      expect(deps.status).toBe(200);
      expect(deps.body.data.total).toBe(0);
      expect((await api().delete(`${API}/clients/${id}`).set(...auth(token))).status).toBe(200);
      expect((await api().get(`${API}/clients/${id}`).set(...auth(token))).status).toBe(404);
    });

    it('bloquea el borrado (409 con detalle) si el cliente tiene datos propios', async () => {
      const id = await newClient(token);
      const gt = await api().post(`${API}/master/garment-types`).set(...auth(token))
        .send({ name: `QA Baja ${Date.now()}`, client_id: id });
      expect(gt.status).toBeLessThan(300);

      const res = await api().delete(`${API}/clients/${id}`).set(...auth(token));
      expect(res.status).toBe(409);
      expect(res.body.errors?.[0]?.dependencies?.garment_types).toBeGreaterThanOrEqual(1);
      // sigue existiendo
      expect((await api().get(`${API}/clients/${id}`).set(...auth(token))).status).toBe(200);
    });

    it('archivar un cliente oculta sus productos en la tienda y reactivarlo los devuelve', async () => {
      const prod = await findPurchasable();
      if (!prod) return; // sin productos comprables en la DB de pruebas
      const admin = await api().get(`${API}/catalog/products/${prod.id}`).set(...auth(token));
      const clientId = admin.body.data?.client_id ?? admin.body.data?.client?.id;
      expect(clientId).toBeTruthy();
      const bust = () => `_t=${Date.now()}${Math.random()}`; // la tienda cachea ~30 s por URL
      try {
        await api().patch(`${API}/clients/${clientId}/archive`).set(...auth(token));
        expect((await api().get(`${API}/store/products/${prod.id}?${bust()}`)).status).toBe(404);
        const list = await api().get(`${API}/store/products?limit=60&${bust()}`);
        expect(asProductList(list.body).some((p: any) => p.id === prod.id)).toBe(false);
      } finally {
        await api().patch(`${API}/clients/${clientId}/restore`).set(...auth(token));
      }
      expect((await api().get(`${API}/store/products/${prod.id}?${bust()}`)).status).toBe(200);
    });

    it('solo admin puede archivar, restaurar y eliminar', async () => {
      const id = await newClient(token);
      for (const role of ['billing', 'seller', 'designer'] as const) {
        const t = await loginAs(role);
        expect((await api().patch(`${API}/clients/${id}/archive`).set(...auth(t))).status).toBe(403);
        expect((await api().delete(`${API}/clients/${id}`).set(...auth(t))).status).toBe(403);
        expect((await api().get(`${API}/clients/${id}/dependencies`).set(...auth(t))).status).toBe(403);
      }
    });
  });
});
