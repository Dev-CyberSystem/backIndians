/* Generador de presupuesto PDF — E-commerce Indians Textil */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join('C:', 'Users', 'USURIO', 'OneDrive', 'Escritorio', 'indians', 'Presupuesto-Ecommerce-Indians.pdf');

// ─── Paleta ──────────────────────────────────────────────────────────────────
const INK     = '#0f172a'; // slate-900
const MUTED   = '#64748b'; // slate-500
const LINE    = '#e2e8f0'; // slate-200
const BRAND   = '#4f46e5'; // indigo-600
const BRANDDK = '#3730a3'; // indigo-800
const SOFT    = '#eef2ff'; // indigo-50
const GREEN   = '#047857'; // emerald-700
const SOFTG   = '#ecfdf5'; // emerald-50

const doc = new PDFDocument({ size: 'A4', margin: 0 });
doc.pipe(fs.createWriteStream(OUT));

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 50;                 // margen lateral
const CW = PAGE_W - M * 2;    // ancho de contenido

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ensureSpace(h) {
  if (doc.y + h > PAGE_H - 70) {
    footer();
    doc.addPage();
    doc.y = 60;
  }
}
function h2(txt) {
  ensureSpace(46);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.rect(M, y + 2, 4, 16).fill(BRAND);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(txt.toUpperCase(), M + 14, y);
  doc.moveDown(0.6);
  doc.fillColor(INK);
}
function para(txt, opts = {}) {
  doc.font('Helvetica').fontSize(opts.size || 10.5).fillColor(opts.color || INK)
     .text(txt, M, doc.y, { width: CW, align: opts.align || 'left', lineGap: opts.lineGap ?? 3 });
  doc.moveDown(opts.gap ?? 0.5);
}
let pageNum = 0;
function footer() {
  const y = PAGE_H - 50;
  doc.save();
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text('Presupuesto E-commerce · Indians Textil', M, y + 8, { width: CW / 2, align: 'left' });
  doc.text('diego.olmi@gmail.com', M + CW / 2, y + 8, { width: CW / 2, align: 'right' });
  doc.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// PORTADA / ENCABEZADO
// ════════════════════════════════════════════════════════════════════════════
doc.rect(0, 0, PAGE_W, 160).fill(INK);
doc.rect(0, 156, PAGE_W, 4).fill(BRAND);

doc.fillColor('#a5b4fc').font('Helvetica-Bold').fontSize(11).text('PROPUESTA DE DESARROLLO', M, 42, { characterSpacing: 2 });
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30).text('Tienda Online a Medida', M, 64, { width: CW });
doc.fillColor('#cbd5e1').font('Helvetica').fontSize(12).text('Plataforma de e-commerce completa, integrada al sistema de gestión', M, 108, { width: CW });

doc.fillColor('#94a3b8').font('Helvetica').fontSize(9)
   .text('Fecha: 23/06/2026', M, 132)
   .text('Validez de la oferta: 15 días', M + CW - 200, 132, { width: 200, align: 'right' });

doc.y = 195;

// ─── Resumen ejecutivo ───────────────────────────────────────────────────────
h2('Resumen ejecutivo');
para('Esta propuesta corresponde al desarrollo integral de una tienda online profesional, construida 100% a medida e integrada al sistema de gestión existente. No se trata de una plantilla genérica ni de un servicio de suscripción: es software propio, sin comisiones por venta ni costos mensuales de plataforma.');
para('El cliente recibe una tienda lista para vender, con tres medios de pago, gestión completa de pedidos, facturación automática y un panel de administración desde el cual controla todo el negocio. Cada módulo fue desarrollado, probado y dejado funcionando de punta a punta.');

// ─── Qué incluye (tabla) ─────────────────────────────────────────────────────
h2('Qué incluye el desarrollo');

const modules = [
  ['Autenticación de clientes', 'Registro, login, ingreso con Google, verificación por email, recuperación de contraseña y sesión segura.'],
  ['Catálogo y búsqueda', 'Listado y detalle de productos, filtros por categoría, género, tipo de prenda, talle y precio, descuentos por producto.'],
  ['Carrito de compras', 'Carrito persistente con gestión de talles, cantidades y recálculo automático de totales.'],
  ['Checkout y pagos', 'Integración real con MercadoPago, pago en efectivo y transferencia bancaria con carga de comprobante. Cupones de descuento y cálculo de envío.'],
  ['Pedidos y cuenta del cliente', 'Historial de compras, perfil, direcciones, estados de pedido, seguimiento de envío y descarga de factura.'],
  ['Facturación y emails', 'Generación automática de facturas en PDF, emails de confirmación y etiqueta de envío imprimible.'],
  ['Panel de administración', 'Tablero con métricas de ventas, gestión de pedidos, cupones, configuración de la tienda y reportes.'],
  ['Landing y diseño', 'Página principal con carruseles, secciones destacadas, diseño profesional y 100% adaptable a celular.'],
];

function moduleRow(title, desc) {
  doc.font('Helvetica-Bold').fontSize(10.5);
  const tH = doc.heightOfString(title, { width: CW - 28 });
  doc.font('Helvetica').fontSize(9.5);
  const dH = doc.heightOfString(desc, { width: CW - 28 });
  const rowH = tH + dH + 16;
  ensureSpace(rowH);
  const y0 = doc.y;
  // check verde
  doc.circle(M + 7, y0 + 7, 7).fill(SOFTG);
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9).text('OK', M + 1.5, y0 + 3.5);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(title, M + 28, y0, { width: CW - 28 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(desc, M + 28, doc.y + 1, { width: CW - 28, lineGap: 2 });
  doc.moveDown(0.5);
  doc.moveTo(M + 28, doc.y).lineTo(PAGE_W - M, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.moveDown(0.5);
}
modules.forEach(([t, d]) => moduleRow(t, d));

// ─── Inversión ───────────────────────────────────────────────────────────────
h2('Inversión');

ensureSpace(150);
const boxY = doc.y;
const boxH = 130;
doc.roundedRect(M, boxY, CW, boxH, 12).fill(SOFT);
doc.roundedRect(M, boxY, CW, boxH, 12).lineWidth(1).strokeColor('#c7d2fe').stroke();

doc.fillColor(BRANDDK).font('Helvetica').fontSize(11).text('Total del desarrollo (llave en mano)', M + 24, boxY + 22);

doc.fillColor(INK).font('Helvetica-Bold').fontSize(34).text('USD 4.500', M + 24, boxY + 42);

doc.fillColor(BRANDDK).font('Helvetica-Bold').fontSize(18)
   .text('$ 6.480.000 ARS', M + 24, boxY + 86);

// caja lateral con cotización
const sideX = M + CW - 200;
doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
   .text('Conversión al tipo de cambio', sideX, boxY + 50, { width: 176, align: 'right' })
   .text('Dólar compra Banco Nación', sideX, boxY + 62, { width: 176, align: 'right' })
   .font('Helvetica-Bold').fillColor(INK)
   .text('USD 1 = $ 1.440 (23/06/2026)', sideX, boxY + 76, { width: 176, align: 'right' });

doc.y = boxY + boxH + 14;
para('Pago único, sin comisiones por venta ni mensualidad de plataforma. El cálculo en pesos se actualiza a la cotización vigente al momento de la firma.', { size: 9, color: MUTED });

// ─── Por qué contratar ───────────────────────────────────────────────────────
h2('Por qué este desarrollo conviene');

const benefits = [
  ['Software propio, sin alquiler', 'A diferencia de Tiendanube o Shopify, no se paga mensualidad ni un porcentaje de cada venta. La tienda es del cliente.'],
  ['Integrado al sistema actual', 'Los productos, el stock y los pedidos viven en el mismo sistema de gestión. No hay que cargar nada dos veces.'],
  ['Tres formas de cobro', 'MercadoPago, efectivo y transferencia con comprobante. El cliente elige cómo quiere recibir el dinero.'],
  ['Listo para vender', 'Se entrega funcionando y publicado, con facturación automática y panel de control. No queda nada "a medias".'],
];
function benefitRow(t, d) {
  doc.font('Helvetica').fontSize(9.5);
  const dH = doc.heightOfString(d, { width: CW - 26 });
  const rowH = dH + 22;
  ensureSpace(rowH);
  const y0 = doc.y;
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text('»', M, y0);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(t, M + 16, y0, { width: CW - 16 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(d, M + 16, doc.y + 1, { width: CW - 16, lineGap: 2 });
  doc.moveDown(0.7);
}
benefits.forEach(([t, d]) => benefitRow(t, d));

// ─── Formas de pago ──────────────────────────────────────────────────────────
h2('Formas de pago sugeridas');
para('Para facilitar la contratación, el proyecto puede abonarse en tres etapas:');

const stages = [
  ['30%', 'Al iniciar', 'USD 1.350  ·  $ 1.944.000'],
  ['40%', 'Flujo de compra funcionando', 'USD 1.800  ·  $ 2.592.000'],
  ['30%', 'Entrega final y publicación', 'USD 1.350  ·  $ 1.944.000'],
];
const colW = CW / 3 - 8;
ensureSpace(90);
const sy = doc.y;
stages.forEach(([pct, label, amt], i) => {
  const x = M + i * (colW + 12);
  doc.roundedRect(x, sy, colW, 78, 10).fill('#f8fafc');
  doc.roundedRect(x, sy, colW, 78, 10).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text(pct, x, sy + 12, { width: colW, align: 'center' });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(label, x + 8, sy + 40, { width: colW - 16, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(amt, x + 6, sy + 58, { width: colW - 12, align: 'center' });
});
doc.y = sy + 78 + 14;
para('También puede abonarse en un único pago. Los montos en pesos se ajustan a la cotización del dólar compra Banco Nación del día de cada pago.', { size: 9, color: MUTED });

// ─── Garantía / cierre ───────────────────────────────────────────────────────
h2('Garantía y soporte');
ensureSpace(70);
const gy = doc.y;
doc.roundedRect(M, gy, CW, 58, 10).fill(SOFTG);
doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10.5).text('30 días de garantía sin cargo', M + 18, gy + 14);
doc.fillColor('#065f46').font('Helvetica').fontSize(9.5)
   .text('Tras la entrega, cualquier ajuste o corrección de errores del desarrollo se realiza sin costo durante 30 días. El mantenimiento mensual y los servicios externos (MercadoPago, dominio, etc.) se cotizan por separado si el cliente lo desea.', M + 18, gy + 32, { width: CW - 36, lineGap: 1.5 });
doc.y = gy + 58 + 16;

para('Quedo a disposición para coordinar una reunión y avanzar con el proyecto. Gracias por la confianza.', { color: INK });
doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Diego Olmi', M, doc.y + 2);
doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Desarrollo de software a medida  ·  diego.olmi@gmail.com', M, doc.y + 1);

footer();
doc.end();
console.log('PDF generado en:', OUT);
