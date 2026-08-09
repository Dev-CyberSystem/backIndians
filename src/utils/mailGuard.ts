import { logger } from './logger';

/**
 * Guarda de seguridad ANTES de entregar cualquier mail a Resend.
 *
 * ─── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El 2026-08-08 una jornada de pruebas mandó **más de 100 mails reales** a
 * direcciones inexistentes (`qa-talle+...@test.local`, `qa-webhook+...@test.local`).
 * Todos rebotaron. Los tests de la tienda crean pedidos de verdad y el sistema
 * dispara su mail de confirmación como con cualquier compra: no había nada que
 * distinguiera "esto es una prueba" de "esto es un cliente".
 *
 * No es un problema estético. Una tasa alta de rebotes **daña la reputación del
 * dominio** ante los proveedores de correo, y el precio lo termina pagando el
 * mail que sí importa: el de confirmación de compra de un cliente real, que
 * empieza a caer en spam o directamente a ser rechazado.
 *
 * ─── Las tres barreras ──────────────────────────────────────────────────────
 *
 * 1. **Bajo Jest nunca se envía.** La suite no tiene por qué tocar la red.
 * 2. **`MAIL_ENABLED=0` corta todo**, para correr los E2E o levantar un dev
 *    server sin riesgo de mandar nada.
 * 3. **Los dominios de prueba se bloquean SIEMPRE**, incluso en producción.
 *    Es la barrera que de verdad importa: no depende de acordarse de setear una
 *    variable, y `@test.local` / `@example.com` no son destinos legítimos en
 *    ningún entorno.
 *
 * La 3 es la que hubiera evitado el incidente: las otras dos dependen de que
 * alguien configure algo, y en el caso de los E2E —que corren contra un dev
 * server normal— nadie lo había configurado.
 */

/** Dominios que nunca corresponden a una persona real. */
const BLOCKED_DOMAINS = [
  'test.local',
  'example.com',
  'example.org',
  'example.net',
  'invalid',
  'localhost',
];

function isBlockedRecipient(to: string): boolean {
  const domain = to.toLowerCase().split('@')[1]?.trim();
  if (!domain) return true; // sin dominio no es una dirección válida
  return BLOCKED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Decide si un mail se puede entregar. Devuelve el motivo del bloqueo, o `null`
 * si se puede enviar.
 */
export function mailBlockedReason(to: string | string[]): string | null {
  // Escotilla SOLO para los tests que verifican el CONTENIDO del mail: mockean
  // el SDK de Resend entero (`jest.mock('resend')`), así que nada sale a la red,
  // pero necesitan que la llamada llegue hasta el mock para poder inspeccionar
  // el payload. Exige estar bajo Jest a propósito: si alguien setea la variable
  // en producción, no hace absolutamente nada.
  if (process.env.MAIL_TEST_DELIVER === '1' && process.env.JEST_WORKER_ID !== undefined) {
    return null;
  }

  if (process.env.JEST_WORKER_ID !== undefined) return 'suite de tests (Jest)';
  if (process.env.MAIL_ENABLED === '0' || process.env.MAIL_ENABLED === 'false') {
    return 'MAIL_ENABLED=0';
  }

  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) return 'sin destinatarios';

  const blocked = recipients.filter(isBlockedRecipient);
  if (blocked.length > 0) return `dominio de prueba (${blocked.join(', ')})`;

  return null;
}

/**
 * Envuelve el envío real. Si el destinatario está bloqueado, lo registra y no
 * llama al proveedor.
 *
 * Devuelve `true` si se entregó, `false` si se bloqueó — el llamador puede
 * ignorarlo: un mail bloqueado no es un error.
 */
export async function guardedSend<T>(
  to: string | string[],
  subject: string,
  send: () => Promise<T>
): Promise<boolean> {
  const reason = mailBlockedReason(to);
  if (reason) {
    logger.info('mail.blocked', {
      message: `Mail NO enviado — ${reason}`,
      meta: { to: Array.isArray(to) ? to.join(', ') : to, subject, reason },
    });
    return false;
  }
  await send();
  return true;
}
