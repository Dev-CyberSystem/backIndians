import cron from 'node-cron';
import { logger } from '../utils/logger';
import { reconcilePendingPayments } from './reconcilePayments';
import { reportDailyInconsistencies } from './reportInconsistencies';

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
  cron.schedule('*/10 * * * *', async () => {
    try {
      await reconcilePendingPayments();
    } catch (err) {
      logger.error('jobs.scheduler.reconcilePaymentsFailed', err);
    }
  });

  // Una vez por día (03:00) — horario de bajo tráfico.
  cron.schedule('0 3 * * *', async () => {
    try {
      await reportDailyInconsistencies();
    } catch (err) {
      logger.error('jobs.scheduler.reportInconsistenciesFailed', err);
    }
  });

  logger.info('jobs.scheduler.started', {
    message: 'Jobs de reconciliación programados (cada 10 min) y de inconsistencias (diario 03:00)',
  });
}
