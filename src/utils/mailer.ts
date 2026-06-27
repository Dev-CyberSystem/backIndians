import { Resend } from 'resend';
import { escapeHtml } from './escapeHtml';

// Mismo proveedor (Resend) y dominio verificado que usa la tienda
// (ver email.service.ts). Reutilizamos RESEND_API_KEY / RESEND_FROM_EMAIL.
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@indians.com.ar';

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

// Template para el email de recuperación de contraseña — mismo estilo de marca
// que los emails de la tienda (ver email.service.ts).
export function buildPasswordResetEmail(resetUrl: string, name?: string): string {
  const intro = name ? `Hola ${escapeHtml(name)}, recibimos` : 'Recibimos';
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1d4ed8;">Restablecer contraseña</h2>
      <p>${intro} una solicitud para restablecer la contraseña de tu cuenta del sistema Indians.</p>
      <a href="${resetUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
        Restablecer contraseña
      </a>
      <p style="color:#6b7280;font-size:13px;">Si no solicitaste este cambio, ignorá este mensaje. Tu contraseña no será modificada.</p>
      <p style="color:#6b7280;font-size:13px;">El enlace expira en 1 hora.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px;">O pegá este enlace en tu navegador:<br>${resetUrl}</p>
    </div>
  `;
}
