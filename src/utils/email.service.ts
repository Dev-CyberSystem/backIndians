import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@indianstextil.com';
const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';

export async function sendVerificationEmail(email: string, name: string, token: string) {
  const link = `${STORE_URL}/auth/verificar?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verificá tu cuenta en Indians Textil',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;">¡Bienvenido/a, ${name}!</h2>
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
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${i.title}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:center;">${i.qty}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">$${i.price.toFixed(2)}</td>
        </tr>`
    )
    .join('');

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Pedido ${orderNumber} confirmado — Indians Textil`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
        <h2 style="color:#1d4ed8;">¡Gracias por tu compra, ${name}!</h2>
        <p>Tu pedido <strong>${orderNumber}</strong> fue recibido correctamente.</p>
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
        <p style="text-align:right;font-weight:700;font-size:18px;">Total: $${total.toFixed(2)}</p>
        <p style="color:#6b7280;font-size:13px;">Nos pondremos en contacto para coordinar la entrega.</p>
      </div>
    `,
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
        <p>Hola ${name}, recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
        <a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
          Restablecer contraseña
        </a>
        <p style="color:#6b7280;font-size:13px;">Si no solicitaste esto, podés ignorar este mensaje.</p>
        <p style="color:#6b7280;font-size:13px;">El enlace expira en 1 hora.</p>
      </div>
    `,
  });
}
