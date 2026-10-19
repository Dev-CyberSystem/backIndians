import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { drawIndiansMark } from './logo';
import { drawIndiansLogoImage, INDIANS_LOGO_ASPECT_RATIO } from './indiansLogoImage';
import { formatPriceNumber } from './money';

// ─── Catálogo PDF de la tienda (presentación a clientes e inversionistas) ────
// Dos versiones del mismo contenido (los productos publicados en la tienda, con
// el precio que figura en la tienda):
//   - commercial: para clientes. Grilla de 6 por página con talles,
//     descripción y un QR por producto que abre su ficha en la tienda.
//   - investor:   para inversionistas. Página de la marca + la colección en
//     números, y una galería de 4 por página con fotos más grandes.
// Si la foto de un producto no se pudo descargar, en su lugar va el isotipo.

export type BrochureVersion = 'commercial' | 'investor';

export interface BrochureProduct {
  id: number;
  title: string;
  description: string | null;
  category: string;
  genderLabel: string | null;
  /** Precio de lista de la tienda (antes del descuento). */
  basePrice: number;
  /** Precio que cobra la tienda (con descuento y redondeo). */
  finalPrice: number;
  discount: number;
  sizes: string[];
  /** JPEG/PNG listo para incrustar, o null si no hay foto o no se pudo bajar. */
  image: Buffer | null;
  /** Ficha del producto en la tienda (destino del QR). */
  url: string;
}

export interface BrochureData {
  version: BrochureVersion;
  /** Fecha de generación, ya en formato dd/mm/aaaa (zona horaria del negocio). */
  generatedOn: string;
  /** "Octubre 2026" para la portada. */
  monthLabel: string;
  storeUrl: string;
  company: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    website: string;
  };
  products: BrochureProduct[];
}

// Paleta de la tienda (frontIndians/tailwind.config.js).
const INK = '#1A1A1A';
const BONE = '#FAF9F7';
const CLAY = '#C17A5A';
const GRAY = '#6B6B6B';
const LIGHT = '#9A9A9A';
const PHOTO_BG = '#F1EEEA';
const MARK_PLACEHOLDER = '#D9D3CC';
const RULE = '#E4E0DB';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
// Zona útil de las páginas de productos: debajo del encabezado + título de la
// categoría, y por encima del pie.
const GRID_TOP = 112;
const FOOTER_Y = 806;

const money = (n: number) => `$ ${formatPriceNumber(n)}`;

const TITLES: Record<BrochureVersion, string> = {
  commercial: 'Catálogo de productos',
  investor: 'Presentación de productos',
};

const MANIFESTO = [
  'En Indians creemos en el esfuerzo de cada día, en la pasión que nos mueve y en la fuerza de '
    + 'avanzar juntos. Nos inspiran quienes se animan a empezar, quienes vuelven a intentarlo y '
    + 'quienes llevan sus colores con orgullo.',
  'Creamos indumentaria para acompañarte en ese camino, dentro y fuera de la cancha. Cada '
    + 'entrenamiento, cada encuentro y cada desafío son una oportunidad para crecer, compartir y '
    + 'dar lo mejor de vos.',
];

/** Texto de una línea, sin saltos ni espacios repetidos (las descripciones vienen del panel). */
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "https://indians.com.ar/tienda" → "indians.com.ar/tienda" (para mostrar). */
const displayUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function groupByCategory(products: BrochureProduct[]): Array<[string, BrochureProduct[]]> {
  const groups = new Map<string, BrochureProduct[]>();
  for (const p of products) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }
  return [...groups.entries()];
}

/**
 * QR dibujado como vector (rectángulos por tramos de módulos oscuros) en vez
 * de PNG: con un QR por producto, codificar y volver a decodificar cientos de
 * PNG era lo más lento del PDF. Además sale nítido al imprimir.
 */
function drawQr(doc: PDFKit.PDFDocument, url: string, x: number, y: number, size: number) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const cell = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules.get(r, c)) { c++; continue; }
      const start = c;
      while (c < n && modules.get(r, c)) c++;
      // +0.01 de solapamiento para que no queden filetes blancos entre tramos.
      doc.rect(x + start * cell, y + r * cell, (c - start) * cell + 0.01, cell + 0.01);
    }
  }
  doc.fill(INK);
}

// ─── Piezas comunes ──────────────────────────────────────────────────────────

function drawCover(doc: PDFKit.PDFDocument, data: BrochureData) {
  // Fondo blanco (no hueso): el PNG del logo del manual de marca trae fondo
  // blanco y sobre el hueso se le veía el recuadro.
  doc.rect(0, 0, PAGE_W, PAGE_H).fill('#FFFFFF');

  const logoH = 64;
  const logoW = logoH * INDIANS_LOGO_ASPECT_RATIO;
  drawIndiansLogoImage(doc, (PAGE_W - logoW) / 2, 280, logoH);

  doc.moveTo(PAGE_W / 2 - 30, 380).lineTo(PAGE_W / 2 + 30, 380).lineWidth(1.5).stroke(CLAY);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(26)
    .text(TITLES[data.version], MARGIN, 404, { width: CONTENT_W, align: 'center' });
  doc.fillColor(GRAY).font('Helvetica').fontSize(12)
    .text(data.monthLabel, MARGIN, 442, { width: CONTENT_W, align: 'center' });

  // Banda inferior con la web y la firma de marca.
  doc.rect(0, PAGE_H - 80, PAGE_W, 80).fill(INK);
  doc.fillColor(BONE).font('Helvetica-Bold').fontSize(11)
    .text(displayUrl(data.company.website), MARGIN, PAGE_H - 50, { width: CONTENT_W / 2, lineBreak: false });
  doc.fillColor(CLAY).font('Helvetica-Bold').fontSize(9)
    .text('ACTITUD EN MOVIMIENTO', PAGE_W / 2, PAGE_H - 48, { width: CONTENT_W / 2, align: 'right', lineBreak: false, characterSpacing: 1.5 });
}

function drawHeader(doc: PDFKit.PDFDocument, data: BrochureData) {
  drawIndiansLogoImage(doc, MARGIN, 28, 20);
  doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
    .text(`${TITLES[data.version]} · ${data.monthLabel}`, PAGE_W / 2, 35, { width: CONTENT_W / 2, align: 'right', lineBreak: false });
  doc.moveTo(MARGIN, 60).lineTo(PAGE_W - MARGIN, 60).lineWidth(0.5).stroke(RULE);
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y = 74) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18)
    .text(title, MARGIN, y, { width: CONTENT_W, lineBreak: false, ellipsis: true });
  doc.rect(MARGIN, y + 25, 24, 2).fill(CLAY);
}

/** Pie en todas las páginas menos la portada (se dibuja al final, con bufferPages). */
function drawFooters(doc: PDFKit.PDFDocument, data: BrochureData) {
  const range = doc.bufferedPageRange();
  const total = range.count - 1;
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(MARGIN, FOOTER_Y).lineTo(PAGE_W - MARGIN, FOOTER_Y).lineWidth(0.5).stroke(RULE);
    doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5);
    doc.text(displayUrl(data.company.website), MARGIN, FOOTER_Y + 8, { width: 180, lineBreak: false });
    doc.text(`Generado el ${data.generatedOn}`, PAGE_W / 2 - 90, FOOTER_Y + 8, { width: 180, align: 'center', lineBreak: false });
    doc.text(`${i} / ${total}`, PAGE_W - MARGIN - 180, FOOTER_Y + 8, { width: 180, align: 'right', lineBreak: false });
  }
}

/** Foto del producto ajustada al recuadro, o el isotipo si no hay foto. */
function drawPhoto(doc: PDFKit.PDFDocument, p: BrochureProduct, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h).fill(PHOTO_BG);
  let drawn = false;
  if (p.image) {
    try {
      doc.image(p.image, x, y, { fit: [w, h], align: 'center', valign: 'center' });
      drawn = true;
    } catch {
      // Imagen corrupta o en un formato que pdfkit no lee: cae al isotipo.
    }
  }
  if (!drawn) {
    const size = Math.min(w, h) * 0.34;
    drawIndiansMark(doc, x + (w - size) / 2, y + (h - size) / 2, size, MARK_PLACEHOLDER);
  }

  if (p.discount > 0) {
    const label = `-${p.discount}%`;
    doc.font('Helvetica-Bold').fontSize(8);
    const bw = doc.widthOfString(label) + 10;
    doc.rect(x + 6, y + 6, bw, 15).fill(CLAY);
    doc.fillColor('#FFFFFF').text(label, x + 6, y + 10, { width: bw, align: 'center', lineBreak: false });
  }
}

/** Precio final + precio de lista tachado si tiene descuento. */
function drawPrice(doc: PDFKit.PDFDocument, p: BrochureProduct, x: number, y: number, size: number) {
  const final = money(p.finalPrice);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(size).text(final, x, y, { lineBreak: false });
  if (p.discount > 0 && p.basePrice > p.finalPrice) {
    const w = doc.widthOfString(final);
    const base = money(p.basePrice);
    const small = size * 0.72;
    doc.fillColor(LIGHT).font('Helvetica').fontSize(small);
    const bx = x + w + 6;
    const by = y + (size - small) * 0.8;
    doc.text(base, bx, by, { lineBreak: false });
    const bw = doc.widthOfString(base);
    doc.moveTo(bx, by + small * 0.38).lineTo(bx + bw, by + small * 0.38).lineWidth(0.6).stroke(LIGHT);
  }
}

// ─── Versión clientes: grilla 3×2 con talles, descripción y QR ──────────────

const C_COLS = 3;
const C_GAP = 14;
const C_ROW_GAP = 18;
const C_CARD_W = (CONTENT_W - C_GAP * (C_COLS - 1)) / C_COLS;
const C_PHOTO_H = C_CARD_W * (4 / 3);
const C_CARD_H = C_PHOTO_H + 100;
const C_QR = 38;

function drawCommercialCard(doc: PDFKit.PDFDocument, p: BrochureProduct, x: number, y: number) {
  drawPhoto(doc, p, x, y, C_CARD_W, C_PHOTO_H);

  const ty = y + C_PHOTO_H + 8;
  const textW = C_CARD_W - C_QR - 6;
  drawQr(doc, p.url, x + C_CARD_W - C_QR, ty, C_QR);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
    .text(oneLine(p.title), x, ty, { width: textW, height: 22, ellipsis: true });
  drawPrice(doc, p, x, ty + 24, 10.5);

  if (p.sizes.length > 0) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(7)
      .text(`Talles: ${p.sizes.join(' · ')}`, x, ty + 40, { width: textW, height: 9, ellipsis: true, lineBreak: false });
  }

  const desc = oneLine(p.description);
  if (desc) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(7)
      .text(desc, x, ty + 54, { width: C_CARD_W, height: 34, ellipsis: true, lineGap: 1 });
  }
}

function drawCommercialProducts(doc: PDFKit.PDFDocument, data: BrochureData) {
  const perPage = C_COLS * 2;
  for (const [category, products] of groupByCategory(data.products)) {
    for (let i = 0; i < products.length; i += perPage) {
      doc.addPage();
      drawHeader(doc, data);
      drawSectionTitle(doc, category);
      const page = products.slice(i, i + perPage);
      for (let j = 0; j < page.length; j++) {
        const col = j % C_COLS;
        const row = Math.floor(j / C_COLS);
        const x = MARGIN + col * (C_CARD_W + C_GAP);
        const y = GRID_TOP + row * (C_CARD_H + C_ROW_GAP);
        drawCommercialCard(doc, page[j], x, y);
      }
    }
  }
}

// ─── Versión inversionistas: marca + números + galería 2×2 ──────────────────

const I_COLS = 2;
const I_GAP = 20;
const I_ROW_GAP = 22;
const I_CARD_W = (CONTENT_W - I_GAP) / I_COLS;
const I_PHOTO_H = 256;
const I_CARD_H = I_PHOTO_H + 64;

function drawInvestorCard(doc: PDFKit.PDFDocument, p: BrochureProduct, x: number, y: number) {
  drawPhoto(doc, p, x, y, I_CARD_W, I_PHOTO_H);
  const ty = y + I_PHOTO_H + 9;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
    .text(oneLine(p.title), x, ty, { width: I_CARD_W * 0.62, height: 14, ellipsis: true, lineBreak: false });

  // Precio alineado a la derecha del título.
  doc.font('Helvetica-Bold').fontSize(11);
  const priceW = doc.widthOfString(money(p.finalPrice));
  drawPrice(doc, { ...p, discount: 0 }, x + I_CARD_W - priceW, ty, 11);

  // La categoría suele coincidir con el género ("Hombre" / masculino): no repetirlo.
  const sameAsCategory = p.genderLabel?.toLowerCase() === p.category.toLowerCase();
  const meta = [p.category, sameAsCategory ? null : p.genderLabel].filter(Boolean).join(' · ');
  const metaLine = p.discount > 0 ? `${meta}  ·  antes ${money(p.basePrice)}` : meta;
  doc.fillColor(CLAY).font('Helvetica').fontSize(7.5)
    .text(metaLine.toUpperCase(), x, ty + 17, { width: I_CARD_W, lineBreak: false, ellipsis: true, characterSpacing: 0.6 });

  const desc = oneLine(p.description);
  if (desc) {
    doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
      .text(desc, x, ty + 31, { width: I_CARD_W, height: 21, ellipsis: true, lineGap: 1 });
  }
}

function drawInvestorProducts(doc: PDFKit.PDFDocument, data: BrochureData) {
  const perPage = I_COLS * 2;
  for (const [category, products] of groupByCategory(data.products)) {
    for (let i = 0; i < products.length; i += perPage) {
      doc.addPage();
      drawHeader(doc, data);
      drawSectionTitle(doc, category);
      const page = products.slice(i, i + perPage);
      for (let j = 0; j < page.length; j++) {
        const x = MARGIN + (j % I_COLS) * (I_CARD_W + I_GAP);
        const y = GRID_TOP + Math.floor(j / I_COLS) * (I_CARD_H + I_ROW_GAP);
        drawInvestorCard(doc, page[j], x, y);
      }
    }
  }
}

function drawStat(doc: PDFKit.PDFDocument, value: string, label: string, x: number, y: number, w: number) {
  doc.rect(x, y, w, 74).fill(BONE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(value.length > 12 ? 15 : 22)
    .text(value, x + 14, y + 16, { width: w - 28, lineBreak: false, ellipsis: true });
  doc.fillColor(GRAY).font('Helvetica').fontSize(8)
    .text(label.toUpperCase(), x + 14, y + 50, { width: w - 28, lineBreak: false, characterSpacing: 0.8 });
}

/** Página de la marca + resumen de la colección (solo versión inversionistas). */
function drawBrandAndNumbers(doc: PDFKit.PDFDocument, data: BrochureData) {
  doc.addPage();
  drawHeader(doc, data);
  drawSectionTitle(doc, 'La marca');

  let y = 124;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
    .text('Indians  |  Actitud en movimiento', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 10;
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY);
  for (const p of MANIFESTO) {
    doc.text(p, MARGIN, y, { width: CONTENT_W, lineGap: 3 });
    y = doc.y + 10;
  }

  y += 16;
  drawSectionTitle(doc, 'La colección en números', y);
  y += 50;

  const products = data.products;
  const groups = groupByCategory(products);
  const prices = products.map((p) => p.finalPrice);
  const priceRange = prices.length
    ? `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`
    : '—';
  const statW = (CONTENT_W - 2 * 12) / 3;
  drawStat(doc, String(products.length), 'Productos publicados', MARGIN, y, statW);
  drawStat(doc, String(groups.length), 'Categorías', MARGIN + statW + 12, y, statW);
  drawStat(doc, priceRange, 'Rango de precios', MARGIN + 2 * (statW + 12), y, statW);
  y += 100;

  // Tabla por categoría: cantidad de productos y rango de precios.
  const cols = [
    { label: 'Categoría', x: MARGIN, w: 220, align: 'left' as const },
    { label: 'Productos', x: MARGIN + 220, w: 90, align: 'right' as const },
    { label: 'Desde', x: MARGIN + 310, w: 100, align: 'right' as const },
    { label: 'Hasta', x: MARGIN + 410, w: CONTENT_W - 410, align: 'right' as const },
  ];
  const header = () => {
    doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(8);
    for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align, lineBreak: false });
    y += 14;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke(RULE);
    y += 7;
  };
  header();
  for (const [category, list] of groups) {
    if (y > FOOTER_Y - 30) {
      doc.addPage();
      drawHeader(doc, data);
      y = 80;
      header();
    }
    const ps = list.map((p) => p.finalPrice);
    const values = [category, String(list.length), money(Math.min(...ps)), money(Math.max(...ps))];
    doc.fillColor(INK).font('Helvetica').fontSize(9.5);
    values.forEach((v, k) => doc.text(v, cols[k].x, y, { width: cols[k].w, align: cols[k].align, lineBreak: false, ellipsis: true }));
    y += 20;
  }
}

// ─── Cierre: dónde comprar / contacto ────────────────────────────────────────

function drawContact(doc: PDFKit.PDFDocument, data: BrochureData) {
  doc.addPage();
  drawHeader(doc, data);
  drawSectionTitle(doc, data.version === 'commercial' ? '¿Cómo comprar?' : 'Contacto');

  let y = 124;
  const intro = data.version === 'commercial'
    ? 'Todos los productos de este catálogo están disponibles en nuestra tienda online. '
      + 'Escaneá el código QR de cada producto para ver su ficha completa y comprarlo, '
      + 'o entrá a la tienda con el código de abajo.'
    : 'Todos los productos de esta presentación están publicados en nuestra tienda online. '
      + 'Escaneá el código para recorrerla.';
  doc.fillColor(GRAY).font('Helvetica').fontSize(10.5).text(intro, MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 24;

  const qrSize = 120;
  drawQr(doc, data.storeUrl, MARGIN, y, qrSize);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
    .text(displayUrl(data.storeUrl), MARGIN + qrSize + 24, y + 8, { width: CONTENT_W - qrSize - 24 });

  const c = data.company;
  const lines = [
    ['Email', c.email],
    ['Teléfono', c.phone],
    ['Dirección', c.address],
    ['Web', displayUrl(c.website)],
  ].filter((l): l is [string, string] => Boolean(l[1]));
  let ly = y + 36;
  for (const [label, value] of lines) {
    doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(7.5)
      .text(label.toUpperCase(), MARGIN + qrSize + 24, ly, { lineBreak: false, characterSpacing: 0.6 });
    doc.fillColor(INK).font('Helvetica').fontSize(10)
      .text(value, MARGIN + qrSize + 24, ly + 10, { width: CONTENT_W - qrSize - 24, lineBreak: false, ellipsis: true });
    ly += 28;
  }
}

function drawEmpty(doc: PDFKit.PDFDocument, data: BrochureData) {
  doc.addPage();
  drawHeader(doc, data);
  doc.fillColor(GRAY).font('Helvetica').fontSize(12)
    .text('Por el momento no hay productos publicados en la tienda.', MARGIN, 140, { width: CONTENT_W, align: 'center' });
}

export async function generateCatalogBrochurePdf(data: BrochureData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: `${TITLES[data.version]} — ${data.company.name}`, Author: data.company.name },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.addPage();
  drawCover(doc, data);

  if (data.products.length === 0) {
    drawEmpty(doc, data);
  } else if (data.version === 'investor') {
    drawBrandAndNumbers(doc, data);
    drawInvestorProducts(doc, data);
  } else {
    drawCommercialProducts(doc, data);
  }
  drawContact(doc, data);
  drawFooters(doc, data);

  doc.end();
  return done;
}
