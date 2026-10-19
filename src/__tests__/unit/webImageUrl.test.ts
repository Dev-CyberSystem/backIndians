import { cloudinary, webImageUrl, UPLOAD_IMAGE_LIMIT } from '../../config/cloudinary';

/*
 * Entrega optimizada de imágenes (consumo de Cloudinary, ciclo 18/09–17/10/2026:
 * 98 % fue ancho de banda de originales crudos). `POST /upload` devuelve esta URL
 * en lugar de `secure_url`; el frontend (`utils/cloudinary.ts`) la reconoce por la
 * forma `/image/upload/f_auto,q_auto/v…/` y le agrega el ancho. Si cambia la forma,
 * hay que actualizar ese helper.
 */

describe('webImageUrl', () => {
  beforeAll(() => {
    cloudinary.config({ cloud_name: 'demo-indians', secure: true });
  });

  it('es https, de imagen pública, con formato y calidad automáticos y versión', () => {
    const url = webImageUrl('indians/landing/abc123');
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo-indians\/image\/upload\/f_auto,q_auto\/v\d+\/indians\/landing\/abc123(\?|$)/);
  });

  it('no fija ancho: lo decide el frontend según dónde se muestra', () => {
    expect(webImageUrl('indians/landing/abc123')).not.toMatch(/[/,]w_\d+/);
  });
});

describe('UPLOAD_IMAGE_LIMIT', () => {
  it('achica el original sin agrandar ni recortar', () => {
    expect(UPLOAD_IMAGE_LIMIT).toEqual({ width: 2560, height: 2560, crop: 'limit' });
  });
});
