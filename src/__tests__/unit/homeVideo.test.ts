import validator from 'validator';
import { cloudinary, homeVideoUrls } from '../../config/cloudinary';

/*
 * Video de la página principal (brief 06.10.2026, pedido 02). El upload real a
 * Cloudinary no se prueba acá (necesita credenciales); sí las URLs que se guardan
 * como configuración pública y que la ruta de settings valida como https.
 */

describe('homeVideoUrls', () => {
  let urls: ReturnType<typeof homeVideoUrls>;

  beforeAll(() => {
    cloudinary.config({ cloud_name: 'demo-indians', secure: true });
    urls = homeVideoUrls('indians/home-video/abc123');
  });

  it('la URL del video es https, de tipo video y con la variante web optimizada', () => {
    expect(urls.url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo-indians\/video\/upload\//);
    expect(urls.url).toContain('w_1280');
    expect(urls.url).toContain('q_auto');
    expect(urls.url).toContain('f_auto');
    expect(urls.url).toContain('indians/home-video/abc123');
  });

  it('la portada es una imagen jpg tomada del primer cuadro', () => {
    expect(urls.poster_url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo-indians\/video\/upload\//);
    expect(urls.poster_url).toContain('so_0');
    expect(urls.poster_url).toMatch(/\.jpg(\?|$)/);
  });

  it('las dos URLs pasan la validación de la ruta de settings (https, con comas y guiones bajos)', () => {
    for (const u of [urls.url, urls.poster_url]) {
      expect(validator.isURL(u, { protocols: ['https'], require_protocol: true })).toBe(true);
      expect(u.length).toBeLessThanOrEqual(500);
    }
  });

  it('rechaza URLs que no son https', () => {
    expect(validator.isURL('http://res.cloudinary.com/x.mp4', { protocols: ['https'], require_protocol: true })).toBe(false);
    expect(validator.isURL('javascript:alert(1)', { protocols: ['https'], require_protocol: true })).toBe(false);
  });
});
