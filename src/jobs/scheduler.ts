import cron from 'node-cron';
import { logger } from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { reconcilePendingPayments } from './reconcilePayments';
import { reportDailyInconsistencies } from './reportInconsistencies';
import { expireStaleOrders } from './expireStaleOrders';

/**
 * Corre un job programado avisando si se cae (D-02 de la auditoría del
 * 2026-08-19).
 *
 * Antes los tres `catch` sólo hacían `logger.error`, y `sendAlert` se invocaba
 * desde un único lugar en todo el sistema (el detector de 5xx). El problema
 * concreto: `reconcilePendingPayments` es hoy el ÚNICO camino por el que se
 * acreditan los pagos de MercadoPago —el webhook está deshabilitado hasta que
 * se configure MP_WEBHOOK_SECRET—, así que si se rompe, los pagos dejan de
 * acreditarse en silencio. Es la forma exacta del incidente del 2026-08-07.
 *
 * Cada job usa su propia `key` para que el cooldown de las alertas corra por
 * separado: un job roto no debe tapar el aviso de otro.
 */
export async function runScheduledJob(
  name: string,
  run: () => Promise<unknown>,
  { impact }: { impact: string }
): Promise<void> {
  try {
    await run();
  } catch (err) {
    logger.error(`jobs.scheduler.${name}Failed`, err);
    await sendAlert({
      key: `job-${name}`,
      severity: 'critical',
      title: `Job "${name}" falló`,
      detail:
        `El job programado "${name}" lanzó una excepción y no completó su corrida.\n\n` +
        `Impacto: ${impact}\n\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `Revisar los logs de Railway filtrando por "jobs.scheduler.${name}Failed".`,
    });
  }
}
/**
 * Scheduler de jobs en proceso (1.8 / C-8). `node-cron` corre dentro del
 * mismo backend — no agrega infraestructura nueva, y Railway ya mantiene
 * este proceso vivo 24/7. Desactivable con `RECONCILE_JOB_ENABLED=0`, y
 * siempre desactivado bajo test (Jest) para no interferir con la DB de los
 * tests ni dejar timers colgados.
 */
export function startScheduledJobs(): void {
  if (process.env.JEST_WORKER_ID !== undefined) return;
  if (process.env.RECONCILE_JOB_ENABLED === '0' || process.env.RECONCILE_JOB_ENABLED === 'false') {
    logger.info('jobs.scheduler.disabled', { message: 'RECONCILE_JOB_ENABLED=0 — jobs de reconciliación desactivados' });
    return;
  }

  // Cada 10 minutos: pagos de MercadoPago que quedaron sin acreditar
  // (webhook perdido o cliente que nunca volvió al sitio).
  cron.schedule('*/10 * * * *', () =>
    runScheduledJob('reconcilePayments', reconcilePendingPayments, {
      impact:
        'Con el webhook de MercadoPago deshabilitado, este job es el único camino por el que se ' +
        'acreditan los pagos. Mientras no corra, los pedidos pagados quedan en pending_payment.',
    })
  );

  // Una vez por día (03:00) — horario de bajo tráfico.
  cron.schedule('0 3 * * *', () =>
    runScheduledJob('reportInconsistencies', reportDailyInconsistencies, {
      impact:
        'Se pierde la detección diaria de pedidos cancelados sin restituir stock, pagos ' +
        'aprobados sin acreditar y cobros sin asiento en caja.',
    })
  );

  // Cada hora: pedidos pending_payment de más de 48hs (2.2) — la ventana es
  // amplia, no hace falta más frecuencia que reconcilePendingPayments.
  cron.schedule('0 * * * *', () =>
    runScheduledJob('expireStaleOrders', expireStaleOrders, {
      impact:
        'Los pedidos impagos dejan de expirar: el stock queda reservado indefinidamente y ' +
        'productos con existencias figuran como agotados en la tienda.',
    })
  );

  logger.info('jobs.scheduler.started', {
    message: 'Jobs de reconciliación (10 min), expiración de pedidos (1 hora) e inconsistencias (diario 03:00) programados',
  });
}
