import { api, API, loginAs, auth } from './helpers';

/*
 * Perfiles y permisos (admin, facturación/billing, taller/workshop, ventas/seller).
 * Verifica que cada rol loguea con su identidad y que la autorización por rol
 * funciona (cada endpoint exige los roles correctos). Requiere `npm run seed`.
 */

describe('Perfiles y permisos — API', () => {
  it('los 4 roles inician sesión con su rol correcto', async () => {
    for (const role of ['admin', 'billing', 'workshop', 'seller'] as const) {
      const token = await loginAs(role);
      const me = await api().get(`${API}/auth/me`).set(...auth(token));
      expect(me.status).toBe(200);
      const expected = role; // el backend usa los mismos nombres de rol
      expect(me.body.data?.role).toBe(expected);
    }
  });

  it('solo admin puede crear prendas (productos base)', async () => {
    const seller = await loginAs('seller');
    const denied = await api().post(`${API}/products`).set(...auth(seller)).send({ name: 'X', base_price: 1000 });
    expect([401, 403]).toContain(denied.status);

    const admin = await loginAs('admin');
    const ok = await api().post(`${API}/products`).set(...auth(admin))
      .send({ name: `Prenda QA ${Date.now()}`, base_price: 1500, category: 'Test' });
    expect(ok.status).toBe(201);
  });

  it('el dashboard (KPIs) es solo para admin y facturación', async () => {
    const seller = await loginAs('seller');
    const denied = await api().get(`${API}/dashboard/summary`).set(...auth(seller));
    expect([401, 403]).toContain(denied.status);

    for (const role of ['admin', 'billing'] as const) {
      const token = await loginAs(role);
      const res = await api().get(`${API}/dashboard/summary`).set(...auth(token));
      expect(res.status).toBe(200);
    }
  });

  it('taller (workshop) no puede crear clientes pero sí ver pedidos', async () => {
    const workshop = await loginAs('workshop');

    const denied = await api().post(`${API}/clients`).set(...auth(workshop)).send({ name: 'Cliente X' });
    expect([401, 403]).toContain(denied.status);

    const orders = await api().get(`${API}/orders`).set(...auth(workshop));
    expect(orders.status).toBe(200);
  });

  it('sin token, los endpoints protegidos responden 401', async () => {
    const res = await api().get(`${API}/clients`);
    expect(res.status).toBe(401);
  });
});
