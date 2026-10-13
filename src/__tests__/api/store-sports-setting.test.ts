import { api, API, loginAs, auth } from './helpers';

/*
 * Menú «Deportes» de la tienda: `store_sports` (categorías separadas por coma, en
 * el orden del menú) la edita el admin y la lee la tienda pública.
 */

const DEFAULT_SPORTS = 'Fútbol, Vóley, Pádel, Running';

describe('Menú Deportes — clave store_sports', () => {
  let admin: string;
  let original: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const res = await api().get(`${API}/settings`).set(...auth(admin));
    original = res.body.data?.store_sports;
  });

  afterAll(async () => {
    // Si no existía, se deja el valor por defecto (vacío significaría «sin deportes»).
    await api().put(`${API}/settings`).set(...auth(admin)).send({ store_sports: original ?? DEFAULT_SPORTS });
  });

  it('el admin la guarda y la tienda pública la publica tal cual', async () => {
    const save = await api().put(`${API}/settings`).set(...auth(admin)).send({ store_sports: 'Fútbol, Básquet, Hockey' });
    expect(save.status).toBe(200);

    const pub = await api().get(`${API}/store/settings?_t=${Date.now()}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data?.store_sports ?? pub.body.store_sports).toBe('Fútbol, Básquet, Hockey');
  });

  it('vacía es un valor válido («sin deportes») y se conserva vacía', async () => {
    const save = await api().put(`${API}/settings`).set(...auth(admin)).send({ store_sports: '' });
    expect(save.status).toBe(200);
    const pub = await api().get(`${API}/store/settings?_t=${Date.now()}`);
    expect(pub.body.data?.store_sports ?? pub.body.store_sports).toBe('');
  });

  it('solo admin/billing pueden cambiarla', async () => {
    const seller = await loginAs('seller');
    const res = await api().put(`${API}/settings`).set(...auth(seller)).send({ store_sports: 'Fútbol' });
    expect([401, 403]).toContain(res.status);
  });
});
