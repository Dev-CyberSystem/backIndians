import nodemailer from 'nodemailer';

// Transportador SMTP reutilizable — se instancia una sola vez
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // true para port 465, false para otros
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: MailOptions): Promise<void> {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Sistema Textil" <no-reply@textil.com>',
    to,
    subject,
    html,
  });
}

// Template para el email de recuperación de contraseña
export function buildPasswordResetEmail(resetUrl: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Recuperación de contraseña</h2>
      <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p>Hacé clic en el botón para crear una nueva contraseña. El enlace es válido por <strong>1 hora</strong>.</p>
      <a href="${resetUrl}"
         style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
                text-decoration:none;border-radius:6px;margin:16px 0;">
        Restablecer contraseña
      </a>
      <p style="color:#666;font-size:13px;">
        Si no solicitaste este cambio, ignorá este email. Tu contraseña no será modificada.
      </p>
      <p style="color:#999;font-size:12px;">
        O pegá este enlace en tu navegador:<br>${resetUrl}
      </p>
    </div>
  `;
}
