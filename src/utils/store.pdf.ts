import PDFDocument from 'pdfkit';

export interface InvoiceItem {
  product_title: string;
  size_name?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface InvoiceData {
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

export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primaryColor = '#1d4ed8';
    const gray = '#6b7280';
    const lightGray = '#e5e7eb';
    const pageWidth = 495; // A4 - 2*50

    // ── Encabezado ─────────────────────────────────────────────────────────────
    doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold').text('Indians Textil', 50, 50);
    doc.fillColor(gray).fontSize(9).font('Helvetica').text('Comprobante de compra', 50, 78);

    // N° pedido y fecha
    const dateStr = new Date(data.createdAt).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    doc.fillColor('#111827').fontSize(11).font('Helvetica-Bold')
      .text(data.orderNumber, 50, 55, { align: 'right', width: pageWidth });
    doc.fillColor(gray).fontSize(9).font('Helvetica')
      .text(dateStr, 50, 70, { align: 'right', width: pageWidth });

    // Línea separadora
    doc.moveTo(50, 95).lineTo(545, 95).strokeColor(lightGray).lineWidth(1).stroke();

    // ── Datos del cliente ───────────────────────────────────────────────────────
    doc.fillColor(gray).fontSize(8).font('Helvetica-Bold').text('CLIENTE', 50, 110);
    doc.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text(data.customerName, 50, 122);
    doc.fillColor(gray).fontSize(9).font('Helvetica').text(data.customerEmail, 50, 136);
    if (data.customerPhone) doc.text(data.customerPhone, 50, 148);

    // ── Datos del envío ─────────────────────────────────────────────────────────
    const shippingX = 320;
    doc.fillColor(gray).fontSize(8).font('Helvetica-Bold').text('ENVÍO', shippingX, 110);
    if (data.shippingType === 'pickup') {
      doc.fillColor('#111827').fontSize(9).font('Helvetica').text('Retiro en tienda', shippingX, 122);
    } else if (data.shippingAddress) {
      const addr = data.shippingAddress;
      doc.fillColor('#111827').fontSize(9).font('Helvetica')
        .text(addr.street ?? '', shippingX, 122)
        .text([addr.city, addr.state, addr.zip_code].filter(Boolean).join(', '), shippingX, 134);
    }
    if (data.trackingNumber || data.courierName) {
      let trackY = data.shippingType === 'pickup' ? 136 : 148;
      if (data.courierName) {
        doc.fillColor(gray).text(`Correo: ${data.courierName}`, shippingX, trackY);
        trackY += 12;
      }
      if (data.trackingNumber) {
        doc.text(`Tracking: ${data.trackingNumber}`, shippingX, trackY);
      }
    }

    // Línea separadora
    doc.moveTo(50, 175).lineTo(545, 175).strokeColor(lightGray).lineWidth(1).stroke();

    // ── Tabla de productos ──────────────────────────────────────────────────────
    let y = 190;
    // Header
    doc.fillColor(gray).fontSize(8).font('Helvetica-Bold');
    doc.text('PRODUCTO', 50, y);
    doc.text('CANT.', 360, y, { width: 50, align: 'center' });
    doc.text('P. UNIT.', 415, y, { width: 60, align: 'right' });
    doc.text('SUBTOTAL', 475, y, { width: 70, align: 'right' });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(lightGray).lineWidth(0.5).stroke();
    y += 8;

    // Filas
    for (const item of data.items) {
      const label = item.size_name
        ? `${item.product_title} — Talle ${item.size_name}`
        : item.product_title;

      doc.fillColor('#111827').fontSize(9).font('Helvetica');
      doc.text(label, 50, y, { width: 305 });
      doc.text(String(item.quantity), 360, y, { width: 50, align: 'center' });
      doc.text(`$${Number(item.unit_price).toFixed(2)}`, 415, y, { width: 60, align: 'right' });
      doc.text(`$${Number(item.subtotal).toFixed(2)}`, 475, y, { width: 70, align: 'right' });

      y += 20;
      // Nueva página si es necesario
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
    }

    // Línea final de tabla
    doc.moveTo(50, y).lineTo(545, y).strokeColor(lightGray).lineWidth(0.5).stroke();
    y += 12;

    // ── Totales ─────────────────────────────────────────────────────────────────
    const totalsX = 350;
    const valX = 545;

    function addTotalRow(label: string, value: string, bold = false, color = '#374151') {
      doc.fillColor(color).fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, totalsX, y);
      doc.text(value, totalsX, y, { width: valX - totalsX, align: 'right' });
      y += 16;
    }

    addTotalRow('Subtotal', `$${data.subtotal.toFixed(2)}`);
    if (data.discountAmount > 0) {
      const label = data.couponCode ? `Descuento (${data.couponCode})` : 'Descuento';
      addTotalRow(label, `−$${data.discountAmount.toFixed(2)}`, false, '#16a34a');
    }
    if (data.shippingCost > 0) {
      addTotalRow('Envío', `$${data.shippingCost.toFixed(2)}`);
    } else if (data.shippingType === 'delivery') {
      addTotalRow('Envío', 'Gratis', false, '#16a34a');
    }

    y += 4;
    doc.moveTo(totalsX, y).lineTo(545, y).strokeColor(primaryColor).lineWidth(0.75).stroke();
    y += 8;
    addTotalRow('TOTAL', `$${data.totalAmount.toFixed(2)}`, true, primaryColor);

    // ── Pie de página ────────────────────────────────────────────────────────────
    doc.fillColor(lightGray).fontSize(8).font('Helvetica')
      .text('Indians Textil — gracias por tu compra', 50, 780, { align: 'center', width: pageWidth });

    doc.end();
  });
}
