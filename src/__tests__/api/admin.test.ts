import { api, API, loginAdmin } from './helpers';

/*
 * Smoke del panel admin vía API: login, identidad y protección de rutas.
 * Requiere el seed del admin (npm run seed:admin).
 */

describe('Admin — API', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  it('el login admin devuelve un access token', () => {
    expect(token).toBeTruthy();
  });

  it('GET /auth/me con token devuelve un usuario admin', async () => {
    const res = await api().get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.role).toBe('admin');
  });

  it('GET /store/admin/coupons exige autenticación', async () => {
    const noAuth = await api().get(`${API}/store/admin/coupons`);
    expect([401, 403]).toContain(noAuth.status);

    const withAuth = await api().get(`${API}/store/admin/coupons`).set('Authorization', `Bearer ${token}`);
    expect(withAuth.status).toBe(200);
    expect(withAuth.body.success).toBe(true);
  });

  it('crea un cupón y lo recupera en el listado', async () => {
    const code = `QA${Date.now().toString().slice(-6)}`;
    const create = await api()
      .post(`${API}/store/admin/coupons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code, type: 'percentage', value: 10, description: 'Cupón de prueba (robot QA)' });

    expect(create.status).toBe(201);
    const list = await api().get(`${API}/store/admin/coupons`).set('Authorization', `Bearer ${token}`);
    const codes = (list.body.data?.rows ?? list.body.data ?? []).map((c: any) => c.code);
    expect(codes).toContain(code);
  });
});
