import PDFDocument from 'pdfkit';
import { drawIndiansLogo } from './logo';

export interface InvoiceItem {
  product_title: string;
  size_name?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface InvoiceData {
  settings?: Record<string, string>;
  orderId?: number;
  orderNumber: string;
  createdAt: Date;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  shippingType: 'pickup' | 'delivery';
  shippingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  } | null;
  couponCode?: string | null;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  trackingNumber?: string | null;
  courierName?: string | null;
}

// Código de comprobante AFIP según la letra. "X" = documento no fiscal (interno).
const INVOICE_TYPE_CODES: Record<string, string> = {
  A: '01', B: '06', C: '11', M: '51', E: '19', X: '99',
};

const money = (n: number) =>
  `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Reproduce el modelo de comprobante del negocio (mismo layout que la factura del
// sistema) para los pedidos de la tienda online. La letra sale "X" por defecto
// (facturación electrónica AFIP aún no desarrollada). Datos fiscales desde settings.
export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const s = data.settings ?? {};

    const invoiceType = String(s.invoice_default_type || 'X').toUpperCase();
    const invoiceCode = INVOICE_TYPE_CODES[invoiceType] ?? '99';
    const pointOfSale = String(s.invoice_point_of_sale || '0001').replace(/\D/g, '').padStart(4, '0').slice(-4);
    const fiscalNumber = `${pointOfSale}-${String(data.orderId ?? 0).padStart(8, '0')}`;
    const ivaCondition = s.company_iva_condition || 'Responsable Inscripto';
    const activityStart = s.company_activity_start || '';
    const companyName = s.company_name || 'INDIANS';

    const addr = data.shippingAddress || {};

    // ── Geometría del marco ────────────────────────────────────────────────────
    const L = 40, R = 555, W = R - L, MID = 300, TOP = 45, BOTTOM = 800;
    doc.lineWidth(1).strokeColor('#000000').rect(L, TOP, W, BOTTOM - TOP).stroke();

    // ── Cabecera ───────────────────────────────────────────────────────────────
    const headerTop = TOP;
    const headerBottom = 185;
    doc.lineWidth(1).moveTo(MID, headerTop).lineTo(MID, headerBottom).stroke('#000000');
    doc.moveTo(L, headerBottom).lineTo(R, headerBottom).stroke('#000000');

    drawIndiansLogo(doc, 55, 56, 30);
    doc.fillColor('#333333').fontSize(6.5).font('Helvetica')
      .text('I N D U M E N T A R I A   D E P O R T I V A', 57, 90, { characterSpacing: 1 });

    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
      .text(companyName.toUpperCase(), 55, 116, { width: MID - 70 });
    doc.fontSize(8).font('Helvetica').fillColor('#000000');
    let compY = 133;
    if (s.company_cuit) { doc.text(`CUIT: ${s.company_cuit}`, 55, compY); compY += 13; }
    doc.text(`Condición frente al IVA: ${ivaCondition}`, 55, compY); compY += 13;
    if (activityStart) doc.text(`Inicio de Actividades: ${activityStart}`, 55, compY);

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
      .text(`FECHA: ${new Date(data.createdAt).toLocaleDateString('es-AR')}`, MID + 14, headerTop + 96);
    doc.text(`IVA: ${ivaCondition.toUpperCase()}`, MID + 14, headerTop + 112);

    // ── Datos del cliente ──────────────────────────────────────────────────────
    const clientTop = headerBottom;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
      .text('DATOS DEL CLIENTE', 55, clientTop + 8);

    const formField = (label: string, value: string | null | undefined, x: number, y: number, w: number) => {
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      const lw = doc.widthOfString(`${label}: `);
      doc.text(`${label}: `, x, y);
      doc.font('Helvetica').fillColor('#000000')
        .text(value || '', x + lw + 2, y, { width: w - lw - 2, ellipsis: true, height: 10 });
      doc.lineWidth(0.5).moveTo(x + lw + 2, y + 10).lineTo(x + w, y + 10).stroke('#BBBBBB');
    };

    const colLX = 55, colLW = 235, colRX = 310, colRW = 235;
    let fy = clientTop + 28;
    formField('Razón Social / Nombre y Apellido', data.customerName, colLX, fy, colLW);
    formField('Domicilio', data.shippingType === 'delivery' ? addr.street : 'Retiro en tienda', colRX, fy, colRW);
    fy += 22;
    formField('Email', data.customerEmail, colLX, fy, colLW);
    formField('Localidad', addr.city, colRX, fy, colRW);
    fy += 22;
    formField('Teléfono', data.customerPhone, colLX, fy, colLW);
    formField('Provincia', addr.state, colRX, fy, colRW - 90);
    formField('C.P.', addr.zip_code, colRX + colRW - 80, fy, 80);

    const clientBottom = fy + 22;
    doc.lineWidth(1).moveTo(L, clientBottom).lineTo(R, clientBottom).stroke('#000000');

    // ── Tabla de ítems ─────────────────────────────────────────────────────────
    const cols = [
      { label: 'CANT.',          x: 40,  w: 52,  align: 'center' as const },
      { label: 'DESCRIPCIÓN',    x: 92,  w: 238, align: 'left' as const },
      { label: 'TALLE / MODELO', x: 330, w: 85,  align: 'left' as const },
      { label: 'PRECIO UNIT.',   x: 415, w: 70,  align: 'right' as const },
      { label: 'IMPORTE',        x: 485, w: 70,  align: 'right' as const },
    ];
    const tableTop = clientBottom;
    const headH = 20;

    doc.rect(L, tableTop, W, headH).fill('#F0F0F0');
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
    for (const c of cols) {
      const pad = c.align === 'left' ? 4 : 0;
      doc.text(c.label, c.x + pad, tableTop + 7, { width: c.w - pad * 2, align: c.align });
    }
    doc.lineWidth(0.75).moveTo(L, tableTop + headH).lineTo(R, tableTop + headH).stroke('#000000');

    let y = tableTop + headH + 6;
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

    for (const item of data.items) {
      drawRow(
        String(item.quantity),
        item.product_title,
        item.size_name || '—',
        money(Number(item.unit_price)),
        money(Number(item.subtotal)),
      );
      if (y > 660) { break; }
    }

    const tableBottom = Math.max(y + 6, tableTop + headH + 60);
    doc.lineWidth(0.5).strokeColor('#CCCCCC');
    for (let i = 1; i < cols.length; i++) {
      doc.moveTo(cols[i].x, tableTop).lineTo(cols[i].x, tableBottom).stroke('#CCCCCC');
    }
    doc.lineWidth(1).moveTo(L, tableBottom).lineTo(R, tableBottom).stroke('#000000');

    // ── Totales ────────────────────────────────────────────────────────────────
    const total = Number(data.totalAmount);
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

    totalRow('SUBTOTAL', money(Number(data.subtotal)));
    if (Number(data.discountAmount) > 0) {
      const label = data.couponCode ? `DESCUENTO (${data.couponCode})` : 'DESCUENTO';
      totalRow(label, `- ${money(Number(data.discountAmount))}`);
    }
    if (Number(data.shippingCost) > 0) {
      totalRow('ENVÍO', money(Number(data.shippingCost)));
    } else if (data.shippingType === 'delivery') {
      totalRow('ENVÍO', 'Gratis');
    }
    totalRow('IVA (21%)', money(ivaAmount));
    totalRow('TOTAL', money(total), true);

    // Referencia del pedido / envío (izquierda)
    doc.fontSize(8).font('Helvetica').fillColor('#333333');
    let noteY = tableBottom + 10;
    doc.text(`Pedido: ${data.orderNumber}`, 55, noteY); noteY += 12;
    if (data.courierName)    { doc.text(`Correo: ${data.courierName}`, 55, noteY); noteY += 12; }
    if (data.trackingNumber) { doc.text(`Tracking: ${data.trackingNumber}`, 55, noteY); noteY += 12; }

    // ── Pie: CAE / QR / firma ──────────────────────────────────────────────────
    const footTop = 690;
    doc.lineWidth(1).moveTo(L, footTop).lineTo(R, footTop).stroke('#000000');

    const qrSize = 68, qrX = 55, qrY = footTop + 12;
    doc.lineWidth(0.75).rect(qrX, qrY, qrSize, qrSize).stroke('#999999');
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text('QR', qrX, qrY + qrSize / 2 - 4, { width: qrSize, align: 'center' });

    const caeX = qrX + qrSize + 16;
    doc.fillColor('#000000').fontSize(8.5).font('Helvetica');
    doc.text('CAE N°: ________________________', caeX, qrY + 2);
    doc.text('VTO. CAE: _____ / _____ / ________', caeX, qrY + 18);
    doc.fontSize(7).fillColor('#444444').font('Helvetica')
      .text('Comprobante autorizado por ARCA', caeX, qrY + 38, { width: 250 })
      .text('Esta Administración Federal de Ingresos Públicos no se responsabiliza por los datos ingresados en el detalle de la operación.', caeX, qrY + 48, { width: 250 });

    doc.lineWidth(0.5).moveTo(R - 200, qrY + 46).lineTo(R - 6, qrY + 46).stroke('#000000');
    doc.fontSize(8).fillColor('#333333').font('Helvetica')
      .text('Firma y Aclaración', R - 200, qrY + 50, { width: 194, align: 'center' })
      .text('Recibí conforme', R - 200, qrY + 62, { width: 194, align: 'center' });

    // ── Contacto (barra inferior) ──────────────────────────────────────────────
    const contact = [s.company_email, s.company_phone].filter(Boolean);
    const web = s.company_website || 'www.indians.com.ar';
    const contactLine = [web, ...contact].join('     |     ');
    doc.lineWidth(0.5).moveTo(L, BOTTOM - 24).lineTo(R, BOTTOM - 24).stroke('#CCCCCC');
    doc.fontSize(8).font('Helvetica').fillColor('#333333')
      .text(contactLine, L, BOTTOM - 18, { width: W, align: 'center' });

    doc.end();
  });
}
