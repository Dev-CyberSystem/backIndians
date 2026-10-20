import { api, API, loginAs, auth } from './helpers';
import { CatalogProductImage } from '../../models';
import PDFDocument from 'pdfkit';
import { brochureImageUrl, storeDisplayPrice } from '../../services/catalogBrochure.service';
import { fitText } from '../../utils/catalogBrochure.pdf';

/*
 * Catálogo PDF (GET /catalog/brochure): presentación para clientes e
 * inversionistas con los productos publicados en la tienda. Las fotos se bajan
 * de Cloudinary; acá `fetch` se simula caído para cubrir el reemplazo por el
 * isotipo (el PDF tiene que generarse igual).
 */

// supertest no junta binarios por defecto: armamos el Buffer del PDF.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Catálogo PDF — API', () => {
  let admin: string;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    // Al menos un producto publicado, con descuento y con una foto. Título y
    // categoría largos a propósito: antes pisaban la línea del precio sugerido.
    const create = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Catálogo PDF QA con un nombre bastante largo ${Date.now()}`,
      category: `Categoría QA con un nombre muy largo ${Date.now()}`,
      gender: 'femenino',
      price: 8000,
      public_price: 12000,
      discount_percentage: 25,
      show_in_store: true,
      stock_quantity: 5,
    });
    expect(create.status).toBe(201);
    await CatalogProductImage.create({
      product_id: create.body.data.id,
      url: 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/indians/catalog/qa.jpg',
      cloudinary_public_id: null,
      sort_order: 0,
    });
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('sin red en tests'));
  });

  afterEach(() => fetchSpy.mockRestore());

  it('admin descarga el catálogo aunque las fotos no carguen', async () => {
    const res = await api()
      .get(`${API}/catalog/brochure`)
      .set(...auth(admin))
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/catalogo-indians-\d{4}-\d{2}-\d{2}\.pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Las fotos se piden en JPEG (pdfkit no lee WebP/AVIF de f_auto).
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => !u.includes('f_auto'))).toBe(true);
  });

  it('facturación también puede descargarlo', async () => {
    const billing = await loginAs('billing');
    const res = await api().get(`${API}/catalog/brochure`).set(...auth(billing));
    expect(res.status).toBe(200);
  });

  it.each(['seller', 'workshop', 'designer'] as const)('%s no puede descargarlo', async (role) => {
    const token = await loginAs(role);
    const res = await api().get(`${API}/catalog/brochure`).set(...auth(token));
    expect(res.status).toBe(403);
  });
});

describe('Catálogo PDF — precio, fotos y texto', () => {
  it('recorta el texto a una línea que entra en el ancho (no pisa lo de abajo)', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.font('Helvetica').fontSize(7.5);
    const long = 'NAVQA 1791910667654-134181 · MUJER';
    const fitted = fitText(doc, long, 120, 0.6);
    expect(fitted.endsWith('…')).toBe(true);
    expect(doc.widthOfString(fitted, { characterSpacing: 0.6 })).toBeLessThanOrEqual(120);
    // Si entra, queda tal cual.
    expect(fitText(doc, 'Hombre', 120, 0.6)).toBe('Hombre');
    doc.end();
  });

  it('muestra el mayorista y, como sugerido, el precio de la tienda (público con descuento y redondeo)', () => {
    expect(storeDisplayPrice({ price: 8000, public_price: 12000, discount_percentage: 25 }))
      .toEqual({ wholesale: 8000, base: 12000, final: 9000, discount: 25 });
    // Sin precio público la tienda cobra el mayorista; descuento fuera de rango no aplica.
    expect(storeDisplayPrice({ price: '8000.00', public_price: null, discount_percentage: 0 }))
      .toEqual({ wholesale: 8000, base: 8000, final: 8000, discount: 0 });
    // El descuento es del precio de la tienda: el mayorista no se toca.
    expect(storeDisplayPrice({ price: 999, public_price: 2000, discount_percentage: 50 }).wholesale).toBe(999);
    expect(storeDisplayPrice({ price: 1000, public_price: null, discount_percentage: 150 }).final).toBe(1000);
    // Redondeo del negocio: ,50 abajo / ,51 arriba (999 * 0.85 = 849,15 → 849).
    expect(storeDisplayPrice({ price: 999, public_price: null, discount_percentage: 15 }).final).toBe(849);
  });

  it('pide JPEG a Cloudinary cuando la URL guardada usa f_auto', () => {
    const url = brochureImageUrl({
      url: 'https://res.cloudinary.com/x/image/upload/ar_3:4,c_fill,g_auto,w_1200/f_auto,q_auto/v1/a.jpg',
      cloudinary_public_id: null,
    });
    expect(url).toContain('f_jpg,q_80');
    expect(url).not.toContain('f_auto');
  });
});
