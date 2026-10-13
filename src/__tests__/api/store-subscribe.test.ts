import { api, API, loginAs, auth } from './helpers';

/*
 * Pop-up de registro con descuento (brief 06.10.2026, pedido 03).
 *
 * Flujo: el visitante deja su email → se crea un cupón personal de un solo uso →
 * lo ve en pantalla (solo la primera vez) y lo recibe por mail → lo canjea en el
 * checkout con la lógica de cupones de siempre.
 */

const KEYS = ['store_welcome_popup_enabled', 'store_welcome_discount_percent', 'store_welcome_valid_days'] as const;

describe('POST /store/subscribe — cupón de bienvenida', () => {
  let admin: string;
  const original: Record<string, string> = {};
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `qa-sub+${stamp}@qa-indians.com.ar`;

  const putSettings = (body: Record<string, string>) => api().put(`${API}/settings`).set(...auth(admin)).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    const res = await api().get(`${API}/settings`).set(...auth(admin));
    for (const k of KEYS) original[k] = res.body.data?.[k] ?? '';
  });

  afterAll(async () => {
    await putSettings(original);
  });

  it('apagado por defecto: responde 404 y no crea nada', async () => {
    await putSettings({ store_welcome_popup_enabled: 'false' });
    const res = await api().post(`${API}/store/subscribe`).send({ email });
    expect(res.status).toBe(404);
  });

  it('con el pop-up activo crea un cupón personal del % configurado', async () => {
    const cfg = await putSettings({ store_welcome_popup_enabled: 'true', store_welcome_discount_percent: '10', store_welcome_valid_days: '30' });
    expect(cfg.status).toBe(200);

    const res = await api().post(`${API}/store/subscribe`).send({ email, name: 'Robot QA' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('created');
    expect(res.body.data.code).toMatch(/^BIENVENIDA-[A-Z0-9]{6}$/);
    expect(res.body.data.discount_percent).toBe(10);

    // Canje con la lógica de siempre: 10% de $50.000 = $5.000
    const code = res.body.data.code as string;
    const valid = await api().post(`${API}/store/coupons/validate`).send({ code, subtotal: 50000 });
    expect(valid.status).toBe(200);
    expect(valid.body.data.discount).toBe(5000);
  });

  it('el mismo email no obtiene un segundo cupón ni se le devuelve el código', async () => {
    const res = await api().post(`${API}/store/subscribe`).send({ email: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'already_registered' });
  });

  it('rechaza con 422 un email inválido', async () => {
    const res = await api().post(`${API}/store/subscribe`).send({ email: 'no-es-un-email' });
    expect(res.status).toBe(422);
  });

  // No hay lista propia del pop-up: la persona queda en la de la newsletter.
  it('el registro aparece en Newsletter → Suscriptores, pendiente de confirmar, con su cupón', async () => {
    const list = await api().get(`${API}/newsletter/subscribers?search=${encodeURIComponent(stamp)}`).set(...auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const row = list.body.data[0];
    expect(row.email).toBe(email);
    expect(row.source).toBe('welcome_popup');
    // El pop-up entrega un cupón, no un permiso: no recibe campañas hasta confirmar desde el mail.
    expect(row.status).toBe('pending');
    expect(row.welcome_coupon.code).toMatch(/^BIENVENIDA-[A-Z0-9]{6}$/);

    // El cupón personal no inunda la lista de cupones que carga el admin a mano.
    const coupons = await api().get(`${API}/store/admin/coupons`).set(...auth(admin));
    expect(coupons.status).toBe(200);
    expect((coupons.body.data as Array<{ code: string }>).some((c) => c.code === row.welcome_coupon.code)).toBe(false);
  });

  it('el CSV de suscriptores incluye el cupón de bienvenida', async () => {
    const res = await api().get(`${API}/newsletter/subscribers/export?search=${encodeURIComponent(stamp)}`).set(...auth(admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(email);
    expect(res.text).toMatch(/BIENVENIDA-[A-Z0-9]{6}/);
  });

  it('quien ya estaba suscripto por otra vía igual recibe su cupón, y sigue suscripto', async () => {
    const other = `qa-sub-prev+${stamp}@qa-indians.com.ar`;
    const added = await api().post(`${API}/newsletter/subscribers`).set(...auth(admin)).send({ email: other });
    expect(added.status).toBeLessThan(300);

    const res = await api().post(`${API}/store/subscribe`).send({ email: other });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('created');

    const list = await api().get(`${API}/newsletter/subscribers?search=${encodeURIComponent(other)}`).set(...auth(admin));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].status).toBe('subscribed');
    expect(list.body.data[0].source).toBe('admin');
    expect(list.body.data[0].welcome_coupon.code).toBe(res.body.data.code);
  });

  it('los endpoints viejos del pop-up ya no existen', async () => {
    expect((await api().get(`${API}/store/admin/subscribers`).set(...auth(admin))).status).toBe(404);
  });

  it('los valores de configuración fuera de rango se rechazan con 422', async () => {
    expect((await putSettings({ store_welcome_discount_percent: '0' })).status).toBe(422);
    expect((await putSettings({ store_welcome_valid_days: '999' })).status).toBe(422);
  });
});
