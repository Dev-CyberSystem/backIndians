import { Resend } from 'resend';
import { generateInvoicePdf, type InvoiceData } from './store.pdf';
import { escapeHtml } from './escapeHtml';
import { guardedSend } from './mailGuard';
import { emailWrapper } from './mailer';
import { formatPriceNumber } from './money';
import type { StoreOrderStatus } from '../models/StoreOrder';

const resendClient = new Resend(process.env.RESEND_API_KEY);

/**
 * Fachada sobre el cliente de Resend que aplica `mailGuard` antes de entregar
 * (ver `mailGuard.ts`). Todos los envíos de la tienda pasan por acá, así que la
 * guarda no depende de que cada punto de envío se acuerde de aplicarla: es la
 * diferencia entre una regla y una convención.
 */
const resend = {
  emails: {
    send: async (payload: Parameters<typeof resendClient.emails.send>[0]) => {
      const to = (payload as { to: string | string[] }).to;
      const subject = (payload as { subject?: string }).subject ?? '(sin asunto)';
      let result: Awaited<ReturnType<typeof resendClient.emails.send>> | undefined;
      await guardedSend(to, subject, async () => {
        result = await resendClient.emails.send(payload);
      });
      return result ?? { data: null, error: null };
    },
  },
};
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
    subject: `Comprobante de compra ${data.orderNumber} — Indians Textil`,
    html: emailWrapper(`
      <h2 style="color:#1d4ed8;margin:0 0 8px;">Comprobante de compra</h2>
      <p style="margin:0 0 12px;">Hola <strong>${escapeHtml(data.customerName)}</strong>, te enviamos el comprobante de tu pedido <strong>${data.orderNumber}</strong>.</p>
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
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">El comprobante en PDF está adjunto a este email. No es válido como factura.</p>
    `, 580),
    attachments: [
      {
        filename: `comprobante-${data.orderNumber}.pdf`,
        content: pdfBuffer.toString('base64'),
      },
    ],
  });
}

// ─── Notificación de cambio de estado del pedido ─────────────────────────────

interface StatusTemplate {
  /** true si este estado NO envía mail (p. ej. estados internos sin novedad útil). */
  skip?: boolean;
  color: string;
  badge?: string;
  title: string;
  intro: string;
  /** Muestra el bloque de transportista + N° de seguimiento si está cargado. */
  showTracking?: boolean;
}

// Copy por estado. Mantiene la identidad visual del mail de confirmación
// (emailWrapper) pero con un texto propio de cada etapa.
function statusTemplate(status: StoreOrderStatus, name: string): StatusTemplate {
  const hi = `Hola ${escapeHtml(name)},`;
  switch (status) {
    case 'paid':
      return {
        color: '#16a34a', badge: '✓ Pago acreditado',
        title: '¡Recibimos tu pago!',
        intro: `${hi} confirmamos el pago de tu pedido. Ya lo estamos preparando.`,
      };
    case 'processing':
      return {
        color: '#1d4ed8', badge: '📦 En preparación',
        title: 'Estamos preparando tu pedido',
        intro: `${hi} tu pedido entró en preparación. Te avisamos apenas salga para el envío.`,
      };
    case 'review':
      return {
        color: '#ea580c', badge: '🔎 En revisión',
        title: 'Estamos revisando tu pedido',
        intro: `${hi} tu pedido está en revisión. En breve continuamos con la preparación.`,
      };
    case 'awaiting_courier':
      return {
        color: '#4f46e5', badge: '⏳ Esperando el correo',
        title: 'Tu pedido está listo para despachar',
        intro: `${hi} tu pedido ya está embalado y esperando que lo retire el correo.`,
      };
    case 'shipped':
      return {
        color: '#7c3aed', badge: '🚚 En camino',
        title: '¡Tu pedido está en camino!',
        intro: `${hi} despachamos tu pedido. Podés seguir el envío con los datos de abajo.`,
        showTracking: true,
      };
    case 'delivered':
      return {
        color: '#059669', badge: '🎉 Entregado',
        title: '¡Tu pedido fue entregado!',
        intro: `${hi} tu pedido fue entregado. ¡Gracias por comprar en Indians Textil!`,
      };
    case 'delayed':
      return {
        color: '#d97706', badge: '⚠️ Demorado',
        title: 'Tu pedido está demorado',
        intro: `${hi} tu pedido sufrió una demora. Estamos trabajando para resolverlo lo antes posible. Disculpá las molestias.`,
        showTracking: true,
      };
    case 'returned':
      return {
        color: '#dc2626', badge: '↩️ Devuelto',
        title: 'Tu pedido fue devuelto',
        intro: `${hi} registramos la devolución de tu pedido. Si tenés dudas, escribinos y te ayudamos.`,
      };
    case 'cancelled':
      return {
        color: '#dc2626', badge: '✕ Cancelado',
        title: 'Tu pedido fue cancelado',
        intro: `${hi} tu pedido fue cancelado. Si creés que es un error, escribinos y lo revisamos.`,
      };
    default:
      // pending_payment u otros estados internos: no notificamos.
      return { skip: true, color: '#6b7280', title: '', intro: '' };
  }
}

export interface StoreOrderStatusEmailParams {
  email: string;
  name: string;
  orderNumber: string;
  status: StoreOrderStatus;
  courierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl: string;
}

/** Indica si un estado dispara mail al comprador (evita construir/enviar de más). */
export function statusNotifiesCustomer(status: StoreOrderStatus): boolean {
  return !statusTemplate(status, '').skip;
}

export async function sendStoreOrderStatusEmail(params: StoreOrderStatusEmailParams): Promise<void> {
  const { email, name, orderNumber, status, courierName, trackingNumber, trackingUrl } = params;
  const tpl = statusTemplate(status, name);
  if (tpl.skip) return;

  const badge = tpl.badge
    ? `<div style="text-align:center;margin-bottom:16px;">
         <span style="display:inline-block;background:${tpl.color}1a;color:${tpl.color};border-radius:999px;padding:10px 18px;font-weight:700;font-size:14px;">
           ${tpl.badge}
         </span>
       </div>`
    : '';

  const trackingBlock = tpl.showTracking && (courierName || trackingNumber)
    ? `<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin:16px 0;">
         ${courierName ? `<tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Transportista</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(courierName)}</td></tr>` : ''}
         ${trackingNumber ? `<tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">N° de seguimiento</td><td style="padding:8px 12px;font-weight:600;font-family:monospace;">${escapeHtml(trackingNumber)}</td></tr>` : ''}
       </table>`
    : '';

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Pedido ${orderNumber}: ${badgeSubject(status)} — Indians Textil`,
    html: emailWrapper(`
      ${badge}
      <h2 style="color:${tpl.color};margin:0 0 8px;">${tpl.title}</h2>
      <p style="margin:0 0 12px;">${tpl.intro}</p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">N° de pedido</p>
      <p style="margin:0 0 12px;font-weight:700;font-family:monospace;">${escapeHtml(orderNumber)}</p>
      ${trackingBlock}
      <div style="text-align:center;margin:20px 0 4px;">
        <a href="${trackingUrl}" style="display:inline-block;background:${tpl.color};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
          Ver seguimiento de mi pedido
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;">O pegá este enlace en tu navegador:<br>${trackingUrl}</p>
    `, 540),
  });
}

// Subject corto por estado (sin emoji, para la línea de asunto).
function badgeSubject(status: StoreOrderStatus): string {
  const map: Partial<Record<StoreOrderStatus, string>> = {
    paid: 'pago acreditado',
    processing: 'en preparación',
    review: 'en revisión',
    awaiting_courier: 'listo para despachar',
    shipped: 'en camino',
    delivered: 'entregado',
    delayed: 'demorado',
    returned: 'devuelto',
    cancelled: 'cancelado',
  };
  return map[status] ?? 'actualización';
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
    subject: '¿Te quedó algo en el carrito? — Indians Textil',
    html: emailWrapper(`
      <h2 style="color:#1d4ed8;margin:0 0 8px;">Hola ${escapeHtml(name)}, ¡te esperamos!</h2>
      <p style="margin:0 0 12px;">Vimos que dejaste algunos productos en tu carrito. Todavía están disponibles — completá tu compra antes de que se agoten.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="text-align:center;margin:20px 0 4px;">
        <a href="${STORE_URL}/carrito" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">
          Volver a mi carrito
        </a>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;">Si ya completaste tu compra, ignorá este mensaje. ¡Gracias por elegirnos!</p>
    `, 520),
  });
}
