import { logger } from './logger';
import { escapeHtml } from './escapeHtml';

// OJO: `mailer` NO se importa acá arriba a propósito. Instancia `new Resend(...)`
// en el top level del módulo, y como este archivo cuelga de `errorHandler` —que
// importa media app— cargarlo estáticamente hace que cualquier import de `app.ts`
// exija `RESEND_API_KEY`. Sin esa variable (como en la suite de tests) revienta
// al importar, y se cae todo. Se carga dinámicamente dentro de `notifyByEmail`,
// que es el único punto donde de verdad hace falta.

/**
 * Envío de alertas operativas al responsable del sistema (condición C7 de la
 * auditoría de preproducción, 2026-08-08). Dos canales: mail (Resend, el mismo
 * proveedor y dominio verificado que ya usa todo el sistema) y WhatsApp
 * (CallMeBot).
 *
 * ─── Qué cubre y qué NO ─────────────────────────────────────────────────────
 *
 * Esto alerta sobre fallas del sistema **estando el proceso vivo**: errores 5xx
 * sostenidos, jobs que fallan, etc.
 *
 * **NO sirve para avisar que el sistema se cayó.** Si el proceso está en
 * crash-loop —como en el incidente del 2026-08-07, que dejó producción abajo
 * más de un día— este código tampoco corre. Para eso hay un watchdog EXTERNO
 * (UptimeRobot) que pega contra `/health`; ver la guía en
 * `documentos/ALERTAS_Y_MONITOREO.md`. Las dos capas son complementarias y
 * ninguna reemplaza a la otra.
 *
 * ─── Criterios de diseño ────────────────────────────────────────────────────
 *
 * - **Nunca lanza.** Una alerta que falla no puede tumbar la request que la
 *   originó — sería convertir un problema en dos.
 * - **Con cooldown por clave.** Sin esto, una falla sostenida manda cientos de
 *   mensajes y el ruido logra que se ignore justo la alerta que importaba.
 * - **Desactivada bajo test y si falta configuración**, para no mandar mails ni
 *   WhatsApps reales desde la suite ni desde un entorno a medio configurar.
 */

export type AlertSeverity = 'critical' | 'warning';

export interface AlertInput {
  /** Clave estable del tipo de alerta — es la unidad del cooldown. */
  key: string;
  title: string;
  detail: string;
  severity?: AlertSeverity;
}

/** Ventana de silencio por clave: una misma alerta no se repite dentro de este lapso. */
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MINUTES ?? 30) * 60 * 1000;

const lastSentAt = new Map<string, number>();

function alertsEnabled(): boolean {
  if (process.env.JEST_WORKER_ID !== undefined) return false;
  if (process.env.ALERTS_ENABLED === '0' || process.env.ALERTS_ENABLED === 'false') return false;
  return true;
}

/** Sólo para los tests: limpia el estado del cooldown entre casos. */
export function __resetAlertCooldown(): void {
  lastSentAt.clear();
}

async function notifyByEmail(input: AlertInput): Promise<void> {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return;

  // Import diferido — ver la nota del encabezado.
  const { sendMail } = await import('./mailer');

  const icon = input.severity === 'warning' ? '⚠️' : '🚨';
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px">
      <h2 style="margin:0 0 8px">${icon} ${escapeHtml(input.title)}</h2>
      <p style="color:#555;margin:0 0 16px">Alerta automática del sistema Indians.</p>
      <pre style="background:#f6f6f6;border:1px solid #e2e2e2;border-radius:8px;padding:12px;
                  white-space:pre-wrap;word-break:break-word;font-size:13px">${escapeHtml(input.detail)}</pre>
      <p style="color:#888;font-size:12px;margin-top:16px">
        ${escapeHtml(new Date().toISOString())} · entorno: ${escapeHtml(process.env.NODE_ENV ?? 'desconocido')}
      </p>
    </div>`;

  await sendMail({ to, subject: `${icon} Indians — ${input.title}`, html });
}

async function notifyByWhatsApp(input: AlertInput): Promise<void> {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return;

  const icon = input.severity === 'warning' ? '⚠️' : '🚨';
  // CallMeBot corta los mensajes largos: se manda lo esencial, el detalle
  // completo va por mail.
  const text = `${icon} Indians — ${input.title}\n${input.detail}`.slice(0, 500);

  const url =
    `https://api.callmebot.com/whatsapp.php` +
    `?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent(text)}` +
    `&apikey=${encodeURIComponent(apikey)}`;

  // Timeout explícito: sin esto, un CallMeBot lento deja la promesa colgada.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CallMeBot respondió ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Manda la alerta por los canales configurados. Best-effort: los fallos se
 * loguean y no se propagan, y un canal caído no impide que salga el otro.
 */
export async function sendAlert(input: AlertInput): Promise<void> {
  if (!alertsEnabled()) return;

  const now = Date.now();
  const previous = lastSentAt.get(input.key);
  if (previous !== undefined && now - previous < COOLDOWN_MS) return;
  lastSentAt.set(input.key, now);

  logger.warn('alerts.dispatch', {
    message: input.title,
    meta: { key: input.key, severity: input.severity ?? 'critical' },
  });

  const results = await Promise.allSettled([notifyByEmail(input), notifyByWhatsApp(input)]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.error(`alerts.${i === 0 ? 'email' : 'whatsapp'}Failed`, r.reason, {
        meta: { key: input.key },
      });
    }
  });
}
