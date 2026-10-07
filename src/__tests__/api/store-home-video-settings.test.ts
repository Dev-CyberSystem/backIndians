import { api, API, loginAs, auth } from './helpers';

/*
 * Video de la página principal (brief 06.10.2026, pedido 02).
 *   - La URL, la portada, el título y el interruptor son públicos (los lee la landing).
 *   - `store_home_video_public_id` es interno: no puede aparecer en `GET /store/settings`.
 *   - Solo URLs https; solo admin/billing pueden subir el video.
 */

const KEYS = [
  'store_home_video_enabled', 'store_home_video_url', 'store_home_video_poster_url',
  'store_home_video_title', 'store_home_video_public_id',
] as const;

describe('Video de la página principal — configuración', () => {
  let admin: string;
  const original: Record<string, string> = {};

  beforeAll(async () => {
    admin = await loginAs('admin');
    const res = await api().get(`${API}/settings`).set(...auth(admin));
    for (const k of KEYS) original[k] = res.body.data?.[k] ?? '';
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send(original);
  });

  it('publica url, portada, título y estado, pero no el public_id', async () => {
    const save = await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_home_video_enabled: 'true',
      store_home_video_url: 'https://res.cloudinary.com/demo/video/upload/c_limit,w_1280/f_auto,q_auto/v1/indians/home-video/qa',
      store_home_video_poster_url: 'https://res.cloudinary.com/demo/video/upload/so_0/v1/indians/home-video/qa.jpg',
      store_home_video_title: 'Mirá cómo hacemos tu camiseta',
      store_home_video_public_id: 'indians/home-video/qa',
    });
    expect(save.status).toBe(200);

    const pub = await api().get(`${API}/store/settings`);
    expect(pub.status).toBe(200);
    const s = pub.body.data ?? pub.body;
    expect(s.store_home_video_enabled).toBe('true');
    expect(s.store_home_video_url).toContain('res.cloudinary.com');
    expect(s.store_home_video_poster_url).toContain('.jpg');
    expect(s.store_home_video_title).toBe('Mirá cómo hacemos tu camiseta');
    expect(s).not.toHaveProperty('store_home_video_public_id');
  });

  it('rechaza con 422 una URL de video que no es https', async () => {
    const res = await api().put(`${API}/settings`).set(...auth(admin)).send({ store_home_video_url: 'http://example.com/v.mp4' });
    expect(res.status).toBe(422);
  });

  it('permite desactivar y quitar el video (valores vacíos)', async () => {
    const res = await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_home_video_enabled: 'false', store_home_video_url: '', store_home_video_poster_url: '', store_home_video_public_id: '',
    });
    expect(res.status).toBe(200);
  });

  it('POST /upload/video: sin token 401, y un vendedor no puede subir (403)', async () => {
    expect((await api().post(`${API}/upload/video`)).status).toBe(401);
    const seller = await loginAs('seller');
    expect((await api().post(`${API}/upload/video`).set(...auth(seller))).status).toBe(403);
  });

  it('POST /upload/video sin archivo responde 400', async () => {
    const res = await api().post(`${API}/upload/video`).set(...auth(admin));
    expect(res.status).toBe(400);
  });
});
