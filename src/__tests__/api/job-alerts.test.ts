/**
 * Alertas cuando falla un job programado (D-02 de la auditoría del 2026-08-19).
 *
 * Hasta el 2026-08-19 `sendAlert` se invocaba desde un solo lugar en todo el
 * sistema (el detector de 5xx). Los tres jobs del scheduler capturaban su
 * excepción y sólo hacían `logger.error`.
 *
 * Por qué importa concretamente: con el webhook de MercadoPago deshabilitado,
 * `reconcilePendingPayments` es el ÚNICO camino por el que se acreditan los
 * pagos. Si se rompe, los pagos dejan de acreditarse y nadie recibe un aviso —
 * la forma exacta del incidente del 2026-08-07.
 *
 * Mismo patrón que alerts.test.ts: se mockea `alerts` y se verifica que el
 * scheduler lo llame, sin mandar nada real.
 */
import { runScheduledJob } from '../../jobs/scheduler';

jest.mock('../../utils/alerts', () => ({
  sendAlert: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendAlert } = require('../../utils/alerts') as { sendAlert: jest.Mock };

describe('D-02 — un job que falla tiene que avisar', () => {
  beforeEach(() => sendAlert.mockClear());

  it('no alerta cuando el job corre bien', async () => {
    await runScheduledJob('jobFeliz', async () => 'listo', { impact: 'ninguno' });
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('alerta cuando el job lanza, con el mensaje del error y el impacto', async () => {
    await runScheduledJob(
      'reconcilePayments',
      async () => { throw new Error('MercadoPago devolvió 503'); },
      { impact: 'Los pagos dejan de acreditarse.' }
    );

    expect(sendAlert).toHaveBeenCalledTimes(1);
    const payload = sendAlert.mock.calls[0][0];
    expect(payload.severity).toBe('critical');
    expect(payload.title).toContain('reconcilePayments');
    // El detalle tiene que servir para actuar sin abrir el código.
    expect(payload.detail).toContain('MercadoPago devolvió 503');
    expect(payload.detail).toContain('Los pagos dejan de acreditarse.');
    expect(payload.detail).toContain('jobs.scheduler.reconcilePaymentsFailed');
  });

  it('cada job usa su propia key — un job roto no puede tapar el aviso de otro', async () => {
    const explota = async () => { throw new Error('boom'); };
    await runScheduledJob('reconcilePayments', explota, { impact: 'x' });
    await runScheduledJob('expireStaleOrders', explota, { impact: 'y' });
    await runScheduledJob('reportInconsistencies', explota, { impact: 'z' });

    const keys = sendAlert.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual(['job-reconcilePayments', 'job-expireStaleOrders', 'job-reportInconsistencies']);
    expect(new Set(keys).size).toBe(3); // el cooldown de sendAlert es por key
  });

  it('la excepción no se propaga — un job caído no debe tumbar el proceso', async () => {
    await expect(
      runScheduledJob('jobRoto', async () => { throw new Error('boom'); }, { impact: 'x' })
    ).resolves.toBeUndefined();
  });

  it('tolera un throw que no es Error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    await runScheduledJob('jobRaro', async () => { throw 'string pelado'; }, { impact: 'x' });
    expect(sendAlert.mock.calls[0][0].detail).toContain('string pelado');
  });
});
