import { Resend } from 'resend';
import { generateInvoicePdf, type InvoiceData } from './store.pdf';
import { escapeHtml } from './escapeHtml';
import { emailWrapper } from './mailer';
import { formatPriceNumber } from './money';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@indians.com.ar';
const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';

// Formato de moneda es-AR: 63000 → "$63.000,00"
const fmtMoney = (n: number) => `$${formatPriceNumber(n)}`;

export async function sendVerificationEmail(email: string, name: string, token: string) {
  const link = `${STORE_URL}/auth/verificar?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verificá tu cuenta en Indians Textil',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;">¡Bienvenido/a, ${escapeHtml(name)}!</h2>
        <p>Gracias por registrarte en nuestra tienda. Para activar tu cuenta hacé clic en el siguiente botón:</p>
        <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
          Verificar mi cuenta
        </a>
        <p style="color:#6b7280;font-size:13px;">Si no te registraste en Indians Textil, podés ignorar este mensaje.</p>
        <p style="color:#6b7280;font-size:13px;">El enlace expira en 24 horas.</p>
      </div>
    `,
  });
}

export async function sendOrderConfirmationEmail(
  email: string,
  name: string,
  orderNumber: string,
  items: { title: string; qty: number; price: number }[],
  total: number
) {
  const itemsHtml = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escapeHtml(i.title)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:center;">${i.qty}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(i.price)}</td>
        </tr>`
    )
    .join('');

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Pedido ${orderNumber} confirmado — Indians Textil`,
    html: emailWrapper(`
      <h2 style="color:#1d4ed8;margin:0 0 8px;">¡Gracias por tu compra, ${escapeHtml(name)}!</h2>
      <p style="margin:0 0 12px;">Tu pedido <strong>${orderNumber}</strong> fue recibido correctamente.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="color:#6b7280;font-size:13px;">
            <th style="text-align:left;padding-bottom:8px;">Producto</th>
            <th style="text-align:center;padding-bottom:8px;">Cant.</th>
            <th style="text-align:right;padding-bottom:8px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="text-align:right;font-weight:700;font-size:18px;margin:0;">Total: ${fmtMoney(total)}</p>
    `, 540),
  });
}

export async function sendPaymentApprovedEmail(
  email: string,
  name: string,
  orderNumber: string,
  total: number
) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Pago confirmado — Pedido ${orderNumber} — Indians Textil`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
        <div style="text-align:center;margin-bottom:16px;">
          <div style="display:inline-block;background:#dcfce7;color:#16a34a;border-radius:999px;padding:12px 20px;font-weight:700;">
            ✓ Pago acreditado
          </div>
        </div>
        <h2 style="color:#16a34a;">¡Tu pago fue aceptado, ${escapeHtml(name)}!</h2>
        <p>Recibimos correctamente el pago de tu pedido <strong>${orderNumber}</strong>.</p>
        <p>Ya estamos <strong>preparando tu pedido</strong>. Te avisaremos cuando esté listo para el retiro o envío.</p>
        <p style="text-align:right;font-weight:700;font-size:18px;margin-top:16px;">Total pagado: ${fmtMoney(total)}</p>
        <p style="color:#6b7280;font-size:13px;">Gracias por comprar en Indians Textil.</p>
      </div>
    `,
  });
}

export async function sendPaymentRejectedEmail(
  email: string,
  name: string,
  orderNumber: string
) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Pago rechazado — Pedido ${orderNumber} — Indians Textil`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
        <h2 style="color:#dc2626;">No pudimos procesar tu pago</h2>
        <p>Hola ${escapeHtml(name)}, el pago de tu pedido <strong>${orderNumber}</strong> fue rechazado o cancelado.</p>
        <p>Podés volver a intentarlo desde tu cuenta, en la sección <strong>Mis pedidos</strong>.</p>
        <a href="${STORE_URL}/mi-cuenta/pedidos" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
          Reintentar el pago
        </a>
        <p style="color:#6b7280;font-size:13px;">Si creés que es un error, escribinos y te ayudamos.</p>
      </div>
    `,
  });
}

export async function sendOrderInvoiceEmail(data: InvoiceData) {
  const pdfBuffer = await generateInvoicePdf(data);

  const itemsHtml = data.items.map((i) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:13px;">
        ${escapeHtml(i.product_title)}${i.size_name ? ` — Talle ${escapeHtml(i.size_name)}` : ''}
      </td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:center;font-size:13px;">${i.quantity}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;">${fmtMoney(Number(i.unit_price))}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;">${fmtMoney(Number(i.subtotal))}</td>
    </tr>
  `).join('');

  const discountRow = data.discountAmount > 0
    ? `<tr><td colspan="3" style="text-align:right;color:#16a34a;padding:4px 0;font-size:13px;">Descuento${data.couponCode ? ` (${escapeHtml(data.couponCode)})` : ''}</td><td style="text-align:right;color:#16a34a;padding:4px 0;font-size:13px;">−${fmtMoney(data.discountAmount)}</td></tr>`
    : '';
  const shippingRow = data.shippingCost > 0
    ? `<tr><td colspan="3" style="text-align:right;padding:4px 0;font-size:13px;">Envío</td><td style="text-align:right;padding:4px 0;font-size:13px;">${fmtMoney(data.shippingCost)}</td></tr>`
    : '';

  await resend.emails.send({
    from: FROM,
    to: data.customerEmail,
    subject: `Factura ${data.orderNumber} — Indians Textil`,
    html: emailWrapper(`
      <h2 style="color:#1d4ed8;margin:0 0 8px;">Comprobante de compra</h2>
      <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(data.customerName)}</strong>, te enviamos la factura de tu pedido <strong>${data.orderNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;text-transform:uppercase;">
            <th style="text-align:left;padding-bottom:6px;">Producto</th>
            <th style="text-align:center;padding-bottom:6px;">Cant.</th>
            <th style="text-align:right;padding-bottom:6px;">P. unit.</th>
            <th style="text-align:right;padding-bottom:6px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        <tfoot>
          ${discountRow}${shippingRow}
          <tr>
            <td colspan="3" style="text-align:right;font-weight:700;font-size:15px;padding-top:8px;color:#1d4ed8;">Total</td>
            <td style="text-align:right;font-weight:700;font-size:15px;padding-top:8px;color:#1d4ed8;">${fmtMoney(data.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">El comprobante en PDF está adjunto a este email.</p>
    `, 580),
    attachments: [
      {
        filename: `factura-${data.orderNumber}.pdf`,
        content: pdfBuffer.toString('base64'),
      },
    ],
  });
}

export async function sendPasswordResetEmailStore(email: string, name: string, token: string) {
  const link = `${STORE_URL}/auth/resetear-password?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Restablecer contraseña — Indians Textil',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;">Restablecer contraseña</h2>
        <p>Hola ${escapeHtml(name)}, recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
        <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
          Restablecer contraseña
        </a>
        <p style="color:#6b7280;font-size:13px;">Si no solicitaste esto, podés ignorar este mensaje.</p>
        <p style="color:#6b7280;font-size:13px;">El enlace expira en 1 hora.</p>
      </div>
    `,
  });
}

export async function sendAbandonedCartEmail(
  email: string,
  name: string,
  products: { id: number; title: string; price: number; image: string | null }[]
) {
  const itemsHtml = products.map((p) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;width:64px;">
        ${p.image
          ? `<img src="${p.image}" alt="${escapeHtml(p.title)}" width="56" style="width:56px;height:56px;object-fit:cover;border-radius:8px;display:block;" />`
          : ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111;">${escapeHtml(p.title)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;font-weight:600;color:#111;">${fmtMoney(p.price)}</td>
    </tr>
  `).join('');

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: '¿Te quedó algo en la bolsa? — Indians Textil',
    html: emailWrapper(`
      <h2 style="color:#1d4ed8;margin:0 0 8px;">Hola ${escapeHtml(name)}, ¡te esperamos!</h2>
      <p style="margin:0 0 12px;">Vimos que dejaste algunos productos en tu bolsa. Todavía están disponibles — completá tu compra antes de que se agoten.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="text-align:center;margin:20px 0 4px;">
        <a href="${STORE_URL}/carrito" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
          Volver a mi bolsa
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;">Si ya completaste tu compra, ignorá este mensaje. ¡Gracias por elegirnos!</p>
    `, 520),
  });
}
