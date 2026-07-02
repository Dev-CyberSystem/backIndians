import { Resend } from 'resend';
import { escapeHtml } from './escapeHtml';

// Mismo proveedor (Resend) y dominio verificado que usa la tienda
// (ver email.service.ts). Reutilizamos RESEND_API_KEY / RESEND_FROM_EMAIL.
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@indians.com.ar';

// Logo de marca alojado en Cloudinary (mismo servicio que usa el resto del
// sistema para imágenes). f_auto/q_auto optimizan formato y peso automáticamente;
// w_200 alcanza para un header de mail sin pesar de más.
const LOGO_URL =
  'https://res.cloudinary.com/dc1mt6q1u/image/upload/f_auto,q_auto,w_200/v1782950608/indians/branding/logo-mail.png';

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: MailOptions): Promise<void> {
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    throw new Error(`Resend: ${error.name} — ${error.message}`);
  }
}

/**
 * Envuelve el contenido de un mail con el header de marca (logo + tagline) y un
 * footer común, dentro de una tarjeta blanca centrada sobre fondo gris claro.
 * Usado por todos los templates de este archivo para que compartan un mismo
 * estilo visual reconocible.
 */
function emailWrapper(bodyHtml: string): string {
  return `
    <div style="background:#f4f4f6;padding:32px 16px;font-family:sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ececef;">
        <div style="text-align:center;padding:32px 24px 16px;">
          <img src="${LOGO_URL}" alt="Indians" width="160" style="display:inline-block;width:160px;max-width:100%;height:auto;" />
          <p style="margin:10px 0 0;color:#9ca3af;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;">
            Ropa deportiva y casual · Tienda online
          </p>
        </div>
        <div style="padding:8px 24px 28px;">
          ${bodyHtml}
        </div>
        <div style="text-align:center;padding:18px 24px;border-top:1px solid #f0f0f0;">
          <p style="color:#9ca3af;font-size:11px;margin:0;">
            Indians Textil · <a href="https://indians.com.ar" style="color:#9ca3af;">indians.com.ar</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

// Etiquetas amigables de rol (mismas que la UI de administración, ver UsersPage.tsx)
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  billing: 'Facturación',
  workshop: 'Taller',
  seller: 'Vendedor',
};

// Template de bienvenida — se envía cuando un administrador crea un usuario.
// Informa los datos de acceso a la cuenta con el mismo estilo de marca.
export function buildWelcomeEmail(params: {
  name: string;
  email: string;
  role: string;
  password?: string;
  loginUrl: string;
}): string {
  const { name, email, role, password, loginUrl } = params;
  const roleLabel = ROLE_LABELS[role] || role;

  const passwordRow = password
    ? `<tr>
         <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Contraseña</td>
         <td style="padding:8px 12px;font-weight:600;font-family:monospace;">${escapeHtml(password)}</td>
       </tr>`
    : '';

  return emailWrapper(`
    <h2 style="color:#1d4ed8;margin:0 0 8px;">¡Bienvenido/a, ${escapeHtml(name)}!</h2>
    <p style="margin:0 0 12px;">Se creó una cuenta para vos en el sistema Indians. Estos son tus datos de acceso:</p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;margin:16px 0;">
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Email</td>
        <td style="padding:8px 12px;font-weight:600;">${escapeHtml(email)}</td>
      </tr>
      ${passwordRow}
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Rol</td>
        <td style="padding:8px 12px;font-weight:600;">${escapeHtml(roleLabel)}</td>
      </tr>
    </table>
    <a href="${loginUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0 16px;">
      Ingresar al sistema
    </a>
    ${password ? '<p style="color:#6b7280;font-size:13px;margin:0 0 8px;">Te recomendamos cambiar tu contraseña luego del primer ingreso.</p>' : ''}
    <p style="color:#9ca3af;font-size:12px;margin:8px 0 0;">O pegá este enlace en tu navegador:<br>${loginUrl}</p>
  `);
}

// Template para el email de recuperación de contraseña — mismo estilo de marca
// que los emails de la tienda (ver email.service.ts).
export function buildPasswordResetEmail(resetUrl: string, name?: string): string {
  const intro = name ? `Hola ${escapeHtml(name)}, recibimos` : 'Recibimos';
  return emailWrapper(`
    <h2 style="color:#1d4ed8;margin:0 0 8px;">Restablecer contraseña</h2>
    <p style="margin:0 0 12px;">${intro} una solicitud para restablecer la contraseña de tu cuenta del sistema Indians.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:8px 0 16px;">
      Restablecer contraseña
    </a>
    <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">Si no solicitaste este cambio, ignorá este mensaje. Tu contraseña no será modificada.</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 12px;">El enlace expira en 1 hora.</p>
    <p style="color:#9ca3af;font-size:12px;margin:0;">O pegá este enlace en tu navegador:<br>${resetUrl}</p>
  `);
}
