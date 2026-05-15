import PDFDocument from 'pdfkit';
import { Order } from '../models/Order';
import { Invoice } from '../models/Invoice';
import { OrderItem } from '../models/OrderItem';
import { Sponsor, Customization } from '../types';
import { CompanySettings } from '../services/settings.service';

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
    const garment = (item as any).garmentType;
    const fabric  = (item as any).fabricType;
    const units   = totalUnits(item);

    doc.moveDown(0.8);

    // Título del ítem
    const itemTitle = [
      garment?.name || 'Prenda',
      fabric?.name ? `(${fabric.name})` : '',
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
      const entries = Object.entries(item.sizes);
      const cellW = Math.min(70, Math.floor(490 / entries.length));
      const startX = 55;
      const headerRowY = doc.y;

      // Cabecera de tallas
      doc.font('Helvetica-Bold');
      entries.forEach(([sizeId], idx) => {
        doc.text(`T${sizeId}`, startX + idx * cellW, headerRowY, { width: cellW, align: 'center' });
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

    // Total del ítem
    const uprice = Number(item.unit_price ?? 0);
    const subtotal = units * uprice;
    doc.fontSize(9).font('Helvetica-Bold')
      .text(`Total unidades: ${units}`, 55, doc.y, { continued: true, width: 490 });
    if (item.unit_price != null) {
      doc.text(`   P.Unit: $${uprice.toFixed(2)}   Subtotal: $${subtotal.toFixed(2)}`, { align: 'right' });
    } else {
      doc.text('');
    }

    // Notas del ítem
    if (item.notes) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Notas: ', 55, doc.y, { continued: true })
        .font('Helvetica').text(item.notes);
    }
  }

  // ── Total general ────────────────────────────────────────────────────────────
  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#000000').moveDown(0.4);
  doc.fontSize(13).font('Helvetica-Bold')
    .text(`TOTAL DEL PEDIDO: $${Number(order.total_amount).toFixed(2)}`, { align: 'right' });

  return streamToBuffer(doc);
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'BORRADOR', issued: 'EMITIDA', paid: 'PAGADA', cancelled: 'ANULADA',
};

// ─── PDF de factura ───────────────────────────────────────────────────────────
export async function generateInvoicePDF(invoice: Invoice, settings?: CompanySettings): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  const order  = (invoice as any).order;
  const client = order?.client;
  const items: OrderItem[] = order?.items || [];
  const extraItems: { description: string; amount: number }[] = (invoice.extra_items as any) || [];
  const discount = Number(invoice.discount_amount ?? 0);

  // ── Encabezado: empresa (izq) + datos factura (der) ────────────────────────
  const headerY = doc.y;

  // Empresa (izquierda)
  if (settings?.company_name) {
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000')
      .text(settings.company_name, 50, headerY, { width: 250 });
    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    if (settings.company_address) doc.text(settings.company_address, 50, doc.y, { width: 250 });
    if (settings.company_cuit)    doc.text(`CUIT: ${settings.company_cuit}`, 50, doc.y, { width: 250 });
    if (settings.company_phone)   doc.text(`Tel: ${settings.company_phone}`, 50, doc.y, { width: 250 });
    if (settings.company_email)   doc.text(settings.company_email, 50, doc.y, { width: 250 });
  }

  // Datos factura (derecha)
  const rightX = 340;
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#000000')
    .text('FACTURA', rightX, headerY, { width: 205, align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor('#333333');
  doc.text(`N°: ${invoice.invoice_number}`, rightX, doc.y, { width: 205, align: 'right' });
  if (order?.order_number) {
    doc.text(`Pedido: ${order.order_number}`, rightX, doc.y, { width: 205, align: 'right' });
  }
  doc.text(`Emisión: ${new Date(invoice.issue_date).toLocaleDateString('es-AR')}`, rightX, doc.y, { width: 205, align: 'right' });
  if (invoice.due_date) {
    doc.text(`Vencimiento: ${new Date(invoice.due_date).toLocaleDateString('es-AR')}`, rightX, doc.y, { width: 205, align: 'right' });
  }
  doc.text(`Estado: ${STATUS_LABELS[invoice.status ?? 'draft'] ?? invoice.status?.toUpperCase()}`, rightX, doc.y, { width: 205, align: 'right' });

  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#000000');
  doc.moveDown(0.6);
  doc.fillColor('#000000');

  // ── Cliente ──────────────────────────────────────────────────────────────────
  if (client) {
    doc.fontSize(10).font('Helvetica-Bold').text('CLIENTE');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#AAAAAA').moveDown(0.3);
    doc.fontSize(9).font('Helvetica');

    const cY = doc.y;
    doc.font('Helvetica-Bold').text(client.name || '-', 55, cY, { width: 235 });
    if (client.contact_name) doc.text(client.contact_name, 55, doc.y, { width: 235 });
    if (client.address)      doc.text(client.address,      55, doc.y, { width: 235 });

    doc.font('Helvetica-Bold').text(`CUIT: `, 310, cY, { continued: true, width: 235 })
      .font('Helvetica').text(client.cuit || '-');
    if (client.phone) {
      doc.font('Helvetica-Bold').text(`Tel: `, 310, doc.y, { continued: true, width: 235 })
        .font('Helvetica').text(client.phone);
    }
    if (client.email) {
      doc.text(client.email, 310, doc.y, { width: 235 });
    }

    doc.moveDown(0.8);
  }

  // ── Detalle de ítems ─────────────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').text('DETALLE');
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#AAAAAA').moveDown(0.3);

  // Cabecera de tabla
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Descripción',   55, doc.y, { width: 280, continued: false });
  doc.text('Cant.',        335, doc.y - doc.currentLineHeight(), { width: 50,  align: 'right' });
  doc.text('P. Unit.',     385, doc.y - doc.currentLineHeight(), { width: 70,  align: 'right' });
  doc.text('Subtotal',     455, doc.y - doc.currentLineHeight(), { width: 90,  align: 'right' });
  doc.moveDown(0.2);
  doc.moveTo(55, doc.y).lineTo(545, doc.y).stroke('#CCCCCC').moveDown(0.3);

  let orderSubtotal = 0;
  doc.font('Helvetica').fontSize(9);

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
      item.color ? item.color : '',
    ].filter(Boolean).join(' — ');

    const rowY = doc.y;
    doc.text(desc, 55, rowY, { width: 280 });
    doc.text(String(units),                    335, rowY, { width: 50,  align: 'right' });
    doc.text(uprice > 0 ? `$${uprice.toFixed(2)}`     : '-', 385, rowY, { width: 70,  align: 'right' });
    doc.text(subtotal > 0 ? `$${subtotal.toFixed(2)}` : '-', 455, rowY, { width: 90,  align: 'right' });
    doc.moveDown(0.3);
  }

  // ítems extra
  for (const ei of extraItems) {
    const rowY = doc.y;
    doc.text(ei.description || '—', 55, rowY, { width: 370 });
    doc.text(`$${Number(ei.amount).toFixed(2)}`, 455, rowY, { width: 90, align: 'right' });
    doc.moveDown(0.3);
  }

  // ── Totales ──────────────────────────────────────────────────────────────────
  doc.moveDown(0.4);
  doc.moveTo(355, doc.y).lineTo(545, doc.y).stroke('#333333').moveDown(0.3);

  const extrasTotal = extraItems.reduce((s, e) => s + Number(e.amount), 0);
  const total = Math.max(0, orderSubtotal + extrasTotal - discount);

  doc.fontSize(9).font('Helvetica');

  if (extrasTotal !== 0) {
    const sY = doc.y;
    doc.text('Subtotal pedido:', 355, sY, { width: 100 });
    doc.text(`$${orderSubtotal.toFixed(2)}`, 455, sY, { width: 90, align: 'right' });
    doc.moveDown(0.3);
  }

  if (discount > 0) {
    const dY = doc.y;
    doc.fillColor('#c0392b').text('Descuento:', 355, dY, { width: 100 });
    doc.text(`-$${discount.toFixed(2)}`, 455, dY, { width: 90, align: 'right' });
    doc.fillColor('#000000').moveDown(0.3);
    doc.moveTo(355, doc.y).lineTo(545, doc.y).stroke('#CCCCCC').moveDown(0.3);
  }

  doc.fontSize(12).font('Helvetica-Bold');
  const tY = doc.y;
  doc.text('TOTAL:', 355, tY, { width: 100 });
  doc.text(`$${total.toFixed(2)}`, 455, tY, { width: 90, align: 'right' });

  // ── Notas ────────────────────────────────────────────────────────────────────
  if (invoice.notes) {
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#CCCCCC').moveDown(0.4);
    doc.fontSize(9).font('Helvetica-Bold').text('Notas:');
    doc.font('Helvetica').text(invoice.notes, 55, doc.y, { width: 490 });
  }

  return streamToBuffer(doc);
}
