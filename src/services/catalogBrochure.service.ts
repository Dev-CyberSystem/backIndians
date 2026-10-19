import { CatalogProduct, CatalogProductImage, CatalogProductSize } from '../models';
import { cloudinary } from '../config/cloudinary';
import { activeClientWhere } from '../utils/storeVisibility';
import { roundPrice } from '../utils/money';
import { businessDate } from '../utils/helpers';
import { logger } from '../utils/logger';
import { getAllSettings } from './settings.service';
import {
  generateCatalogBrochurePdf,
  type BrochureProduct,
  type BrochureVersion,
} from '../utils/catalogBrochure.pdf';

// Catálogo PDF para presentar a clientes e inversionistas. Toma exactamente lo
// que la tienda publica (mismo filtro que listStoreProducts: show_in_store,
// active y cliente activo). El precio principal es el MAYORISTA (`price`) y el
// de la tienda online va como "Precio sugerido de venta al público". No usa la
// ficha técnica: es material para mandar afuera.

export const BROCHURE_VERSIONS: BrochureVersion[] = ['commercial', 'investor'];

const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';
const UNCATEGORIZED = 'Otros';
const IMAGE_TIMEOUT_MS = 10_000;
const IMAGE_CONCURRENCY = 6;

const GENDER_LABELS: Record<string, string> = {
  masculino: 'Hombre',
  femenino: 'Mujer',
  infantil: 'Niños',
  unisex: 'Unisex',
};

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Precio mayorista (`price`, redondeado) y precio de la tienda: de lista
 * (`base`) y final (`final`, el "sugerido al público"). El de la tienda usa el
 * precio público (o el mayorista si no tiene), descuento válido entre 1 y 100 y
 * la regla de redondeo: MISMO cálculo que `effectivePrice` de
 * frontIndians/src/utils/price.ts.
 */
export function storeDisplayPrice(p: {
  price: number | string;
  public_price: number | string | null;
  discount_percentage: number | null;
}): { wholesale: number; base: number; final: number; discount: number } {
  const base = Number(p.public_price ?? p.price);
  const d = Number(p.discount_percentage ?? 0);
  const discount = d > 0 && d <= 100 ? d : 0;
  return {
    wholesale: roundPrice(p.price),
    base: roundPrice(base),
    final: roundPrice(discount > 0 ? (base * (100 - discount)) / 100 : base),
    discount,
  };
}

/**
 * URL para bajar la foto en un formato que pdfkit pueda incrustar. Las URLs
 * guardadas piden f_auto (Cloudinary podría devolver WebP/AVIF, que pdfkit no
 * lee), así que se pide JPEG explícito, en 3:4 y 640 px de ancho: alcanza para
 * imprimir las tarjetas del catálogo y pesa ~100 KB.
 */
export function brochureImageUrl(img: { url: string; cloudinary_public_id: string | null }): string {
  if (img.cloudinary_public_id && cloudinary.config().cloud_name) {
    return cloudinary.url(img.cloudinary_public_id, {
      secure: true,
      transformation: [
        { aspect_ratio: '3:4', width: 640, crop: 'fill', gravity: 'auto' },
        { fetch_format: 'jpg', quality: 80 },
      ],
    });
  }
  return img.url.replace(/\bf_auto\b/g, 'f_jpg').replace(/\bq_auto\b/g, 'q_80');
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return isJpeg(buf) || isPng(buf) ? buf : null;
  } catch {
    return null;
  }
}

/** Baja las fotos con concurrencia limitada; la que falla queda en null (va el isotipo). */
async function downloadAll(urls: Array<string | null>): Promise<Array<Buffer | null>> {
  const out: Array<Buffer | null> = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      if (url) out[i] = await downloadImage(url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, urls.length) }, worker));
  return out;
}

export async function buildCatalogBrochure(version: BrochureVersion): Promise<{ buffer: Buffer; filename: string }> {
  const rows = await CatalogProduct.findAll({
    where: { show_in_store: true, active: true, ...activeClientWhere() },
    attributes: ['id', 'title', 'description', 'price', 'public_price', 'discount_percentage', 'category', 'gender'],
    include: [
      { model: CatalogProductImage, as: 'images', attributes: ['url', 'cloudinary_public_id', 'sort_order'], separate: true, order: [['sort_order', 'ASC']] },
      { model: CatalogProductSize, as: 'sizes', attributes: ['size_name', 'sort_order'], separate: true, order: [['sort_order', 'ASC']] },
    ],
    order: [['title', 'ASC'], ['id', 'ASC']],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = rows.map((r) => r.get({ plain: true }) as any);
  const firstImages = products.map((p) => (p.images?.[0] ? brochureImageUrl(p.images[0]) : null));
  const images = await downloadAll(firstImages);

  const missing = images.filter((img, i) => !img && firstImages[i]).length;
  if (missing > 0) {
    // Las fotos que no se pudieron bajar van con el isotipo en su lugar.
    logger.warn('catalog.brochure.imagesMissing', { meta: { missing, total: products.length, version } });
  }

  const items: BrochureProduct[] = products.map((p, i) => {
    const price = storeDisplayPrice(p);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: (p.category ?? '').trim() || UNCATEGORIZED,
      genderLabel: p.gender ? GENDER_LABELS[p.gender] ?? null : null,
      wholesalePrice: price.wholesale,
      basePrice: price.base,
      finalPrice: price.final,
      discount: price.discount,
      sizes: (p.sizes ?? []).map((s: { size_name: string }) => s.size_name),
      image: images[i],
      url: `${STORE_URL}/productos/${p.id}`,
    };
  });

  // Categorías en orden alfabético y "Otros" al final; dentro de cada una, por título.
  items.sort((a, b) => {
    if (a.category !== b.category) {
      if (a.category === UNCATEGORIZED) return 1;
      if (b.category === UNCATEGORIZED) return -1;
      return a.category.localeCompare(b.category, 'es');
    }
    return a.title.localeCompare(b.title, 'es');
  });

  const s = await getAllSettings();
  const today = businessDate(); // YYYY-MM-DD en la zona horaria del negocio
  const [yyyy, mm, dd] = today.split('-');

  const buffer = await generateCatalogBrochurePdf({
    version,
    generatedOn: `${dd}/${mm}/${yyyy}`,
    monthLabel: `${MONTHS[Number(mm) - 1]} ${yyyy}`,
    storeUrl: STORE_URL,
    company: {
      name: s.company_name || 'Indians',
      email: s.company_email || undefined,
      phone: s.company_phone || undefined,
      address: s.company_address || undefined,
      website: s.company_website || 'www.indians.com.ar',
    },
    products: items,
  });

  const suffix = version === 'investor' ? 'inversionistas' : 'clientes';
  return { buffer, filename: `catalogo-indians-${suffix}-${today}.pdf` };
}
