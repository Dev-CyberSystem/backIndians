import { logger } from './logger';

/**
 * Despachador de mails desacoplado del request. El proyecto no tiene un sistema
 * de colas (Redis/Bull), así que resolvemos el requisito en proceso:
 *
 *  - `enqueueEmail` corre el envío en el próximo tick (`setImmediate`), por lo
 *    que NUNCA bloquea ni corta el guardado del cambio de estado.
 *  - Reintenta con backoff ante fallos transitorios de Resend.
 *  - Cada intento/fallo/éxito queda logueado de forma estructurada (`logger`),
 *    para poder auditar y reintentar manualmente si se agotan los reintentos.
 *
 * Si en el futuro se agrega una cola real, solo hay que reemplazar el cuerpo de
 * `enqueueEmail` por el `queue.add(...)` correspondiente.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000; // 2s, 4s, 8s...

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(jobName: string, task: () => Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await task();
      logger.info('emailQueue.sent', { meta: { job: jobName, attempt } });
      return;
    } catch (err) {
      const isLast = attempt === MAX_ATTEMPTS;
      logger.error('emailQueue.attemptFailed', err, {
        meta: { job: jobName, attempt, willRetry: !isLast, fatal: false },
      });
      if (isLast) {
        // Se agotaron los reintentos: queda logueado como error definitivo.
        // El cambio de estado ya se persistió; el mail se puede reenviar a mano.
        logger.error('emailQueue.exhausted', err, { meta: { job: jobName, fatal: false } });
        return;
      }
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * Encola un envío de mail. Devuelve de inmediato; el envío ocurre en segundo
 * plano. `jobName` es solo para trazabilidad en los logs.
 */
export function enqueueEmail(jobName: string, task: () => Promise<void>): void {
  setImmediate(() => {
    void runWithRetry(jobName, task);
  });
}

/**
 * Variante que espera el resultado (con reintentos). Útil en tests o cuando se
 * quiere confirmar el envío de forma sincrónica.
 */
export function sendEmailWithRetry(jobName: string, task: () => Promise<void>): Promise<void> {
  return runWithRetry(jobName, task);
}
