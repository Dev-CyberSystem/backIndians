import PDFDocument from 'pdfkit';
import { Order } from '../models/Order';
import { Invoice } from '../models/Invoice';
import { OrderItem } from '../models/OrderItem';
import { SizeChart } from '../models/SizeChart';
import { Sponsor, Customization } from '../types';
import { CompanySettings } from '../services/settings.service';
import { drawIndiansLogo } from './logo';

function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function totalUnits(item: OrderItem): number {
  if (!item.sizes) return 0;
  return Object.values(item.sizes).reduce((s, q) => s + q, 0);
}

const LINE = (doc: PDFKit.PDFDocument) =>
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#CCCCCC').moveDown(0.4);

const SECTION = (doc: PDFKit.PDFDocument, title: string) => {
  doc.moveDown(0.6);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a1a').text(title.toUpperCase());
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#333333').moveDown(0.3);
  doc.font('Helvetica').fillColor('#000000');
};

function labelValue(doc: PDFKit.PDFDocument, label: string, value: string | null | undefined, x = 55, width = 490) {
  if (!value) return;
  doc.fontSize(9)
    .font('Helvetica-Bold').text(`${label}: `, x, doc.y, { continued: true, width })
    .font('Helvetica').text(value);
}

function collarLabel(t: string | null | undefined): string {
  if (t === 'v') return 'Cuello V';
  if (t === 'round') return 'Cuello Redondo';
  if (t === 'mao') return 'Cuello Mao';
  return '-';
}

function sleeveLabel(t: string | null | undefined): string {
  if (t === 'raglan') return 'Raglan';
  if (t === 'classic') return 'Clásica';
  return '-';
}

// ─── Ficha técnica de pedido ──────────────────────────────────────────────────
export async function generateOrderPDF(order: Order): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

  const client  = (order as any).client;
  const creator = (order as any).creator;
  const seller  = (order as any).seller;
  const items: OrderItem[] = (order as any).items || [];

  // Mapa de talles: id → nombre
  const sizeCharts: SizeChart[] = await SizeChart.findAll({ attributes: ['id', 'name'] });
  const sizeMap: Record<string, string> = Object.fromEntries(
    sizeCharts.map((s) => [String(s.id), s.name])
  );

  // ── Encabezado ──────────────────────────────────────────────────────────────
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000')
    .text('FICHA TÉCNICA DE PEDIDO', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#555555')
    .text(`N° ${order.order_number}  ·  ${new Date().toLocaleDateString('es-AR')}  ·  Estado: ${order.status?.toUpperCase()}`, { align: 'center' });
  doc.fillColor('#000000');
  doc.moveDown(0.6);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#000000');
  doc.moveDown(0.5);

  // ── Datos del pedido ────────────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').text('DATOS DEL PEDIDO');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#333333').moveDown(0.3);

  const infoY = doc.y;
  doc.fontSize(9).font('Helvetica');
  // Columna izquierda
  doc.font('Helvetica-Bold').text('Cliente: ', 55, infoY, { continued: true, width: 235 })
    .font('Helvetica').text(client?.name || '-');
  if (client?.contact_name) {
    doc.font('Helvetica-Bold').text('Contacto: ', 55, doc.y, { continued: true, width: 235 })
      .font('Helvetica').text(client.contact_name);
  }
  if (client?.phone) {
    doc.font('Helvetica-Bold').text('Teléfono: ', 55, doc.y, { continued: true, width: 235 })
      .font('Helvetica').text(client.phone);
  }

  // Columna derecha (datos de gestión)
  const rightX = 310;
  doc.font('Helvetica-Bold').text('Vendedor: ', rightX, infoY, { continued: true, width: 235 })
    .font('Helvetica').text(seller?.name || '-');
  doc.font('Helvetica-Bold').text('Creado por: ', rightX, doc.y, { continued: true, width: 235 })
    .font('Helvetica').text(creator?.name || '-');
  if (order.delivery_date) {
    doc.font('Helvetica-Bold').text('Entrega: ', rightX, doc.y, { continued: true, width: 235 })
      .font('Helvetica').text(new Date(order.delivery_date).toLocaleDateString('es-AR'));
  }

  doc.moveDown(0.5);

  if (order.notes) {
    labelValue(doc, 'Notas del pedido', order.notes);
  }
  if (order.workshop_notes) {
    labelValue(doc, 'Notas para el taller', order.workshop_notes);
  }

  // ── Ítems ────────────────────────────────────────────────────────────────────
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const garment     = (item as any).garmentType;
    const stockFabrics: { id: number; name: string }[] = (item as any).stockFabrics ?? [];
    const stockFabric  = (item as any).stockFabric;
    const fabricNames  = stockFabrics.length > 0
      ? stockFabrics.map((f) => f.name).join(', ')
      : stockFabric?.name ?? (item as any).fabricType?.name ?? null;
    const units   = totalUnits(item);

    doc.moveDown(0.8);

    // Título del ítem
    const itemTitle = [
      garment?.name || 'Prenda',
      fabricNames ? `(${fabricNames})` : '',
    ].filter(Boolean).join(' ');

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000')
      .text(`ÍTEM ${i + 1} — ${itemTitle}`);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#000000').moveDown(0.4);

    // ── Diseño y colores ────────────────────────────────────────────────────
    SECTION(doc, 'Diseño y colores');

    const colW = 235;
    const leftX = 55;
    const rX = 310;
    const designY = doc.y;

    doc.fontSize(9);
    doc.font('Helvetica-Bold').text('Color principal: ', leftX, designY, { continued: true, width: colW })
      .font('Helvetica').text(item.color || '-');
    doc.font('Helvetica-Bold').text('Cuello: ', rX, designY, { continued: true, width: colW })
      .font('Helvetica').text(collarLabel(item.collar_type));

    if (item.color_secondary || item.sleeve_type) {
      const r2Y = doc.y;
      if (item.color_secondary) {
        doc.font('Helvetica-Bold').text('Color secundario: ', leftX, r2Y, { continued: true, width: colW })
          .font('Helvetica').text(item.color_secondary);
      }
      doc.font('Helvetica-Bold').text('Manga: ', rX, r2Y, { continued: true, width: colW })
        .font('Helvetica').text(sleeveLabel(item.sleeve_type));
    }

    if (item.color_sleeves || item.color_collar || item.color_seam_tape) {
      const r3Y = doc.y;
      if (item.color_sleeves) {
        doc.font('Helvetica-Bold').text('Color mangas: ', leftX, r3Y, { continued: true, width: colW })
          .font('Helvetica').text(item.color_sleeves);
      }
      if (item.color_collar) {
        doc.font('Helvetica-Bold').text('Color cuello: ', rX, r3Y, { continued: true, width: colW })
          .font('Helvetica').text(item.color_collar);
      }
      if (item.color_seam_tape) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').text('Tapa costura: ', leftX, doc.y, { continued: true, width: colW })
          .font('Helvetica').text(item.color_seam_tape);
      }
    }

    // ── Materiales de aplicación ────────────────────────────────────────────
    const hasMaterials = item.logo_material || item.size_label_type || item.composition_label;
    if (hasMaterials) {
      SECTION(doc, 'Materiales de aplicación');
      doc.fontSize(9);
      labelValue(doc, 'Marca / Escudo', item.logo_material);
      labelValue(doc, 'Talle', item.size_label_type);
      labelValue(doc, 'Etiqueta composición', item.composition_label);
    }

    // ── Detalle de tela ─────────────────────────────────────────────────────
    const hasFabric = item.fabric_composition || item.fabric_weight;
    if (hasFabric) {
      SECTION(doc, 'Detalle de tela');
      doc.fontSize(9);
      labelValue(doc, 'Composición', item.fabric_composition);
      labelValue(doc, 'Gramaje', item.fabric_weight);
    }

    // ── Sponsors ────────────────────────────────────────────────────────────
    const sponsors: Sponsor[] = (item.sponsors as Sponsor[]) || [];
    if (sponsors.length > 0) {
      SECTION(doc, 'Sponsors / Apliques');
      doc.fontSize(9);

      // Cabecera de tabla
      const sColX = [55, 300];
      const sHeaderY = doc.y;
      doc.font('Helvetica-Bold')
        .text('Elemento', sColX[0], sHeaderY, { width: 240 })
        .text('Ubicación', sColX[1], sHeaderY, { width: 240 });
      doc.moveDown(0.2);
      doc.moveTo(55, doc.y).lineTo(540, doc.y).stroke('#AAAAAA').moveDown(0.2);

      doc.font('Helvetica');
      for (const sp of sponsors) {
        const spY = doc.y;
        doc.text(sp.element || '-', sColX[0], spY, { width: 240 });
        doc.text(sp.location || '-', sColX[1], spY, { width: 240 });
        doc.moveDown(0.2);
      }
    }

    // ── Personalización ─────────────────────────────────────────────────────
    const custom: Customization | null = item.customization as Customization | null;
    if (custom) {
      SECTION(doc, 'Personalización');
      doc.fontSize(9).font('Helvetica');
      const yesNo = (v: boolean) => (v ? 'Sí' : 'No');

      const custY = doc.y;
      doc.font('Helvetica-Bold').text('Número en espalda: ', 55, custY, { continued: true, width: 235 })
        .font('Helvetica').text(yesNo(custom.number_on_back));
      doc.font('Helvetica-Bold').text('Número en pecho: ', 310, custY, { continued: true, width: 235 })
        .font('Helvetica').text(yesNo(custom.number_on_chest));

      const custY2 = doc.y;
      doc.font('Helvetica-Bold').text('Nombre jugador: ', 55, custY2, { continued: true, width: 235 })
        .font('Helvetica').text(yesNo(custom.player_name));
      if (custom.number_font) {
        doc.font('Helvetica-Bold').text('Tipografía: ', 310, custY2, { continued: true, width: 235 })
          .font('Helvetica').text(custom.number_font);
      }

      if (custom.number_color_home || custom.number_color_away) {
        const custY3 = doc.y;
        if (custom.number_color_home) {
          doc.font('Helvetica-Bold').text('Color nro. titular: ', 55, custY3, { continued: true, width: 235 })
            .font('Helvetica').text(custom.number_color_home);
        }
        if (custom.number_color_away) {
          doc.font('Helvetica-Bold').text('Color nro. alternativa: ', 310, custY3, { continued: true, width: 235 })
            .font('Helvetica').text(custom.number_color_away);
        }
      }
    }

    // ── Bordado ─────────────────────────────────────────────────────────────
    if (item.has_embroidery) {
      SECTION(doc, 'Bordado');
      doc.fontSize(9).font('Helvetica');
      if (item.embroidery_notes) {
        doc.text(item.embroidery_notes, 55, doc.y, { width: 490 });
      } else {
        doc.text('Incluye bordado (sin notas adicionales).', 55, doc.y, { width: 490 });
      }
    }

    // ── Accesorios ──────────────────────────────────────────────────────────
    const hasAccessories = item.short_description || item.socks_description;
    if (hasAccessories) {
      SECTION(doc, 'Accesorios');
      doc.fontSize(9).font('Helvetica');
      labelValue(doc, 'Short / Bermuda', item.short_description);
      labelValue(doc, 'Medias', item.socks_description);
    }

    // ── Tallas y cantidades ─────────────────────────────────────────────────
    SECTION(doc, 'Tallas y cantidades');
    doc.fontSize(9);

    if (item.sizes && Object.keys(item.sizes).length > 0) {
      const entries = Object.entries(item.sizes).filter(([, q]) => q > 0);
      const cellW = Math.min(70, Math.floor(490 / Math.max(entries.length, 1)));
      const startX = 55;
      const headerRowY = doc.y;

      // Cabecera con nombres de talles
      doc.font('Helvetica-Bold');
      entries.forEach(([sizeId], idx) => {
        const sizeName = sizeMap[sizeId] ?? `T${sizeId}`;
        doc.text(sizeName, startX + idx * cellW, headerRowY, { width: cellW, align: 'center' });
      });
      doc.moveDown(0.2);
      doc.moveTo(55, doc.y).lineTo(55 + entries.length * cellW, doc.y).stroke('#AAAAAA').moveDown(0.2);

      // Cantidades
      doc.font('Helvetica');
      const qtyRowY = doc.y;
      entries.forEach(([, qty], idx) => {
        doc.text(String(qty), startX + idx * cellW, qtyRowY, { width: cellW, align: 'center' });
      });
      doc.moveDown(0.5);
    } else {
      doc.font('Helvetica').text('Sin tallas definidas.', 55, doc.y);
      doc.moveDown(0.3);
    }

    doc.fontSize(9).font('Helvetica-Bold').text(`Total unidades: ${units}`, 55, doc.y);

    // ── Jugadores por talle ──────────────────────────────────────────────────
    const playersData = item.players_data as Record<string, { name: string; number: string }[]> | null;
    if (playersData && Object.keys(playersData).length > 0) {
      SECTION(doc, 'Jugadores por talle');
      doc.fontSize(9);
      const pColX = [55, 180, 330];
      const pHeaderY = doc.y;
      doc.font('Helvetica-Bold')
        .text('Talle', pColX[0], pHeaderY, { width: 120 })
        .text('Nombre', pColX[1], pHeaderY, { width: 145 })
        .text('Número', pColX[2], pHeaderY, { width: 100 });
      doc.moveDown(0.2);
      doc.moveTo(55, doc.y).lineTo(540, doc.y).stroke('#AAAAAA').moveDown(0.2);
      doc.font('Helvetica');
      for (const [sizeId, players] of Object.entries(playersData)) {
        const sizeName = sizeMap[sizeId] ?? sizeId;
        for (const player of players) {
          const pY = doc.y;
          doc.text(sizeName, pColX[0], pY, { width: 120 });
          doc.text(player.name || '-', pColX[1], pY, { width: 145 });
          doc.text(player.number || '-', pColX[2], pY, { width: 100 });
          doc.moveDown(0.25);
        }
      }
    }

    // Notas del ítem
    if (item.notes) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Notas: ', 55, doc.y, { continued: true })
        .font('Helvetica').text(item.notes);
    }
  }

  return streamToBuffer(doc);
}

// Código de comprobante AFIP según la letra. "X" = documento no fiscal (interno).
const INVOICE_TYPE_CODES: Record<string, string> = {
  A: '01', B: '06', C: '11', M: '51', E: '19', X: '99',
};

const money = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─── PDF de factura ───────────────────────────────────────────────────────────
// Reproduce el modelo de comprobante del negocio. La letra del comprobante es
// configurable a futuro (facturación electrónica aún no desarrollada): por
// defecto sale "X". Los datos fiscales de la empresa se toman de la configuración.
export async function generateInvoicePDF(
  invoice: Invoice,
  settings?: CompanySettings | Record<string, string>,
): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const s = (settings ?? {}) as Record<string, string>;

  const order  = (invoice as any).order;
  const client = order?.client;
  const items: OrderItem[] = order?.items || [];
  const extraItems: { description: string; amount: number }[] = (invoice.extra_items as any) || [];
  const discount = Number(invoice.discount_amount ?? 0);

  // Talles: id → nombre
  const sizeCharts: SizeChart[] = await SizeChart.findAll({ attributes: ['id', 'name'] });
  const sizeMap: Record<string, string> = Object.fromEntries(sizeCharts.map((c) => [String(c.id), c.name]));

  // Tipo de comprobante (por factura aún no configurable → por defecto "X")
  const invoiceType = String((invoice as any).invoice_type || s.invoice_default_type || 'X').toUpperCase();
  const invoiceCode = INVOICE_TYPE_CODES[invoiceType] ?? '99';

  const pointOfSale  = String(s.invoice_point_of_sale || '0001').replace(/\D/g, '').padStart(4, '0').slice(-4);
  const fiscalNumber = `${pointOfSale}-${String(invoice.id).padStart(8, '0')}`;
  const ivaCondition = s.company_iva_condition || 'Responsable Inscripto';
  const activityStart = s.company_activity_start || '';
  const companyName  = s.company_name || 'INDIANS';

  // ── Geometría del marco ──────────────────────────────────────────────────────
  const L = 40, R = 555;               // límites horizontales del contenido
  const W = R - L;                     // ancho útil
  const MID = 300;                     // divisor cabecera empresa / comprobante
  const TOP = 45, BOTTOM = 800;

  doc.lineWidth(1).strokeColor('#000000').rect(L, TOP, W, BOTTOM - TOP).stroke();

  // ── Cabecera ─────────────────────────────────────────────────────────────────
  const headerTop = TOP;
  const headerBottom = 185;
  // divisor vertical y línea inferior de cabecera
  doc.lineWidth(1).moveTo(MID, headerTop).lineTo(MID, headerBottom).stroke('#000000');
  doc.moveTo(L, headerBottom).lineTo(R, headerBottom).stroke('#000000');

  // Logo / marca (izquierda): isotipo (molinete) + wordmark "indians"
  drawIndiansLogo(doc, 55, 56, 30);
  doc.fillColor('#333333').fontSize(6.5).font('Helvetica')
    .text('I N D U M E N T A R I A   D E P O R T I V A', 57, 90, { characterSpacing: 1 });

  // Datos fiscales de la empresa (izquierda, debajo del logo)
  doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
    .text(companyName.toUpperCase(), 55, 116, { width: MID - 70 });
  doc.fontSize(8).font('Helvetica').fillColor('#000000');
  let compY = 133;
  if (s.company_cuit) { doc.text(`CUIT: ${s.company_cuit}`, 55, compY); compY += 13; }
  doc.text(`Condición frente al IVA: ${ivaCondition}`, 55, compY); compY += 13;
  if (activityStart) doc.text(`Inicio de Actividades: ${activityStart}`, 55, compY);

  // "FACTURA" + recuadro de letra (derecha)
  const boxSize = 46;
  const boxX = R - boxSize - 14;
  const boxY = headerTop + 8;
  doc.lineWidth(1).rect(boxX, boxY, boxSize, boxSize).stroke('#000000');
  doc.fontSize(30).font('Helvetica-Bold').fillColor('#000000')
    .text(invoiceType, boxX, boxY + 8, { width: boxSize, align: 'center' });

  doc.fontSize(28).font('Helvetica-Bold')
    .text('FACTURA', MID + 12, headerTop + 14, { width: boxX - MID - 16 });
  doc.fontSize(8.5).font('Helvetica').fillColor('#333333')
    .text(`Código N° ${invoiceCode}`, MID + 14, headerTop + 46);

  doc.fontSize(17).font('Helvetica-Bold').fillColor('#000000')
    .text(`N° ${fiscalNumber}`, MID + 12, headerTop + 68);
  doc.fontSize(9).font('Helvetica').fillColor('#000000')
    .text(`FECHA: ${new Date(invoice.issue_date).toLocaleDateString('es-AR')}`, MID + 14, headerTop + 96);
  doc.text(`IVA: ${ivaCondition.toUpperCase()}`, MID + 14, headerTop + 112);

  // ── Datos del cliente ────────────────────────────────────────────────────────
  const clientTop = headerBottom;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
    .text('DATOS DEL CLIENTE', 55, clientTop + 8);

  const formField = (label: string, value: string | null | undefined, x: number, y: number, w: number) => {
    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    const lw = doc.widthOfString(`${label}: `);
    doc.text(`${label}: `, x, y);
    doc.font('Helvetica').fillColor('#000000').text(value || '', x + lw + 2, y, { width: w - lw - 2, ellipsis: true, height: 10 });
    doc.lineWidth(0.5).moveTo(x + lw + 2, y + 10).lineTo(x + w, y + 10).stroke('#BBBBBB');
  };

  const colLX = 55, colLW = 235;
  const colRX = 310, colRW = 235;
  let fy = clientTop + 28;
  formField('Razón Social / Nombre y Apellido', client?.name, colLX, fy, colLW);
  formField('Domicilio', client?.address, colRX, fy, colRW);
  fy += 22;
  formField('CUIT / DNI', client?.cuit, colLX, fy, colLW);
  formField('Localidad', null, colRX, fy, colRW);
  fy += 22;
  formField('Condición IVA', null, colLX, fy, colLW);
  formField('Provincia', null, colRX, fy, colRW - 90);
  formField('C.P.', null, colRX + colRW - 80, fy, 80);

  const clientBottom = fy + 22;
  doc.lineWidth(1).moveTo(L, clientBottom).lineTo(R, clientBottom).stroke('#000000');

  // ── Tabla de ítems ───────────────────────────────────────────────────────────
  // columnas: CANT. | DESCRIPCIÓN | TALLE/MODELO | PRECIO UNIT. | IMPORTE
  const cols = [
    { key: 'cant',  label: 'CANT.',        x: 40,  w: 52,  align: 'center' as const },
    { key: 'desc',  label: 'DESCRIPCIÓN',  x: 92,  w: 238, align: 'left' as const },
    { key: 'model', label: 'TALLE / MODELO', x: 330, w: 85, align: 'left' as const },
    { key: 'price', label: 'PRECIO UNIT.', x: 415, w: 70,  align: 'right' as const },
    { key: 'total', label: 'IMPORTE',      x: 485, w: 70,  align: 'right' as const },
  ];
  const tableTop = clientBottom;
  const headH = 20;

  // cabecera de tabla
  doc.rect(L, tableTop, W, headH).fill('#F0F0F0');
  doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
  for (const c of cols) {
    const pad = c.align === 'left' ? 4 : 0;
    doc.text(c.label, c.x + pad, tableTop + 7, { width: c.w - pad * 2, align: c.align });
  }
  doc.lineWidth(0.75).moveTo(L, tableTop + headH).lineTo(R, tableTop + headH).stroke('#000000');

  // filas
  let y = tableTop + headH + 6;
  let orderSubtotal = 0;
  doc.font('Helvetica').fontSize(8.5).fillColor('#000000');

  const drawRow = (cant: string, desc: string, model: string, price: string, total: string) => {
    const descH = doc.heightOfString(desc, { width: cols[1].w - 8 });
    const rowH = Math.max(16, descH + 4);
    doc.fillColor('#000000');
    doc.text(cant,  cols[0].x, y, { width: cols[0].w, align: 'center' });
    doc.text(desc,  cols[1].x + 4, y, { width: cols[1].w - 8, align: 'left' });
    doc.text(model, cols[2].x + 4, y, { width: cols[2].w - 8, align: 'left' });
    doc.text(price, cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(total, cols[4].x, y, { width: cols[4].w, align: 'right' });
    y += rowH;
  };

  for (const item of items) {
    const garment = (item as any).garmentType;
    const fabric  = (item as any).fabricType;
    const units   = totalUnits(item);
    const uprice  = Number(item.unit_price ?? 0);
    const subtotal = units * uprice;
    orderSubtotal += subtotal;

    const desc = [
      garment?.name || 'Prenda',
      fabric?.name ? `(${fabric.name})` : '',
      item.color || '',
    ].filter(Boolean).join(' — ');

    const sizeNames = item.sizes
      ? Object.entries(item.sizes)
          .filter(([, q]) => (q as number) > 0)
          .map(([id]) => sizeMap[id] ?? id)
          .join(', ')
      : '';

    drawRow(
      String(units),
      desc,
      sizeNames || '—',
      uprice > 0 ? money(uprice) : '—',
      subtotal > 0 ? money(subtotal) : '—',
    );
  }

  const extrasTotal = extraItems.reduce((sum, e) => sum + Number(e.amount), 0);
  for (const ei of extraItems) {
    drawRow('1', ei.description || '—', '', money(Number(ei.amount)), money(Number(ei.amount)));
  }

  // borde inferior del cuerpo de la tabla y separadores verticales
  const tableBottom = Math.max(y + 6, tableTop + headH + 60);
  doc.lineWidth(0.5).strokeColor('#CCCCCC');
  for (let i = 1; i < cols.length; i++) {
    doc.moveTo(cols[i].x, tableTop).lineTo(cols[i].x, tableBottom).stroke('#CCCCCC');
  }
  doc.lineWidth(1).moveTo(L, tableBottom).lineTo(R, tableBottom).stroke('#000000');

  // ── Totales ──────────────────────────────────────────────────────────────────
  const grossSubtotal = orderSubtotal + extrasTotal;
  const total   = Math.max(0, grossSubtotal - discount);
  const netBase = total / 1.21;
  const ivaAmount = total - netBase;

  const totLabelX = 380, totValX = 470, totValW = R - totValX - 6;
  let ty = tableBottom + 10;

  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9).fillColor('#000000');
    doc.text(label, totLabelX, ty, { width: totValX - totLabelX - 6, align: 'left' });
    doc.text(value, totValX, ty, { width: totValW, align: 'right' });
    doc.lineWidth(0.5).moveTo(totValX, ty + (bold ? 16 : 13)).lineTo(R - 6, ty + (bold ? 16 : 13)).stroke('#BBBBBB');
    ty += bold ? 22 : 18;
  };

  totalRow('SUBTOTAL', money(grossSubtotal));
  totalRow('DESCUENTO', discount > 0 ? `- ${money(discount)}` : money(0));
  totalRow('IVA (21%)', money(ivaAmount));
  totalRow('TOTAL', money(total), true);

  // Notas / referencia del pedido (izquierda, junto a los totales)
  doc.fontSize(8).font('Helvetica').fillColor('#333333');
  let noteY = tableBottom + 10;
  if (order?.order_number) { doc.text(`Pedido: ${order.order_number}`, 55, noteY); noteY += 12; }
  if (invoice.notes) doc.text(invoice.notes, 55, noteY, { width: totLabelX - 70 });

  // ── Pie: CAE / QR / firma ────────────────────────────────────────────────────
  const footTop = 690;
  doc.lineWidth(1).moveTo(L, footTop).lineTo(R, footTop).stroke('#000000');

  // Recuadro QR (placeholder — sin facturación electrónica aún no hay QR real)
  const qrSize = 68;
  const qrX = 55, qrY = footTop + 12;
  doc.lineWidth(0.75).rect(qrX, qrY, qrSize, qrSize).stroke('#999999');
  doc.fontSize(7).font('Helvetica').fillColor('#999999')
    .text('QR', qrX, qrY + qrSize / 2 - 4, { width: qrSize, align: 'center' });

  // CAE (líneas para completar)
  const caeX = qrX + qrSize + 16;
  doc.fillColor('#000000').fontSize(8.5).font('Helvetica');
  doc.text('CAE N°: ________________________', caeX, qrY + 2);
  doc.text('VTO. CAE: _____ / _____ / ________', caeX, qrY + 18);
  doc.fontSize(7).fillColor('#444444').font('Helvetica')
    .text('Comprobante autorizado por ARCA', caeX, qrY + 38, { width: 250 })
    .text('Esta Administración Federal de Ingresos Públicos no se responsabiliza por los datos ingresados en el detalle de la operación.', caeX, qrY + 48, { width: 250 });

  // Firma
  doc.lineWidth(0.5).moveTo(R - 200, qrY + 46).lineTo(R - 6, qrY + 46).stroke('#000000');
  doc.fontSize(8).fillColor('#333333').font('Helvetica')
    .text('Firma y Aclaración', R - 200, qrY + 50, { width: 194, align: 'center' })
    .text('Recibí conforme', R - 200, qrY + 62, { width: 194, align: 'center' });

  // ── Contacto (barra inferior) ────────────────────────────────────────────────
  const contact = [s.company_email && s.company_email, s.company_phone && s.company_phone]
    .filter(Boolean);
  const web = s.company_website || 'www.indians.com.ar';
  const contactLine = [web, ...contact].join('     |     ');
  doc.lineWidth(0.5).moveTo(L, BOTTOM - 24).lineTo(R, BOTTOM - 24).stroke('#CCCCCC');
  doc.fontSize(8).font('Helvetica').fillColor('#333333')
    .text(contactLine, L, BOTTOM - 18, { width: W, align: 'center' });

  return streamToBuffer(doc);
}
