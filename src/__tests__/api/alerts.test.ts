/**
 * Alertas operativas (condición C7 de la auditoría de preproducción).
 *
 * Se testea la LÓGICA de disparo —umbral, ventana y cooldown—, no el envío
 * real: `sendAlert` se apaga solo bajo Jest para no mandar mails ni WhatsApps
 * de verdad desde la suite, así que acá se mockea `alerts` y se verifica que el
 * monitor lo llame cuando corresponde.
 */
import { recordServerError, __resetErrorRate } from '../../utils/errorRateMonitor';

jest.mock('../../utils/alerts', () => ({
  sendAlert: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendAlert } = require('../../utils/alerts') as { sendAlert: jest.Mock };

const err = (n: number) => ({ method: 'POST', url: `/api/v1/x/${n}`, message: `boom ${n}` });

describe('C7 — detector de errores 5xx sostenidos', () => {
  beforeEach(() => {
    __resetErrorRate();
    sendAlert.mockClear();
  });

  it('no alerta mientras no se supere el umbral', () => {
    // Umbral por defecto: 10 en 5 minutos.
    for (let i = 0; i < 9; i++) recordServerError(err(i));
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('alerta al alcanzar el umbral', () => {
    for (let i = 0; i < 10; i++) recordServerError(err(i));
    expect(sendAlert).toHaveBeenCalledTimes(1);

    const payload = sendAlert.mock.calls[0][0];
    expect(payload.key).toBe('errores-5xx-sostenidos');
    expect(payload.severity).toBe('critical');
    // El detalle tiene que servir para actuar: qué ruta y qué error.
    expect(payload.detail).toContain('/api/v1/x/9');
    expect(payload.detail).toContain('boom 9');
  });

  it('no re-dispara con cada error nuevo después de alertar', () => {
    for (let i = 0; i < 10; i++) recordServerError(err(i));
    expect(sendAlert).toHaveBeenCalledTimes(1);

    // La ventana se limpia al alertar: sin eso, el contador quedaba por encima
    // del umbral y mandaba un aviso por CADA 5xx siguiente.
    for (let i = 0; i < 9; i++) recordServerError(err(100 + i));
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('vuelve a alertar si se acumula otra tanda completa', () => {
    for (let i = 0; i < 10; i++) recordServerError(err(i));
    for (let i = 0; i < 10; i++) recordServerError(err(100 + i));
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });
});

/*
 * Nota: que `sendAlert` esté apagado bajo Jest no se testea explícitamente —
 * queda verificado de hecho por la suite entera. Si no lo estuviera, cada
 * corrida de `npm run test:full` mandaría mails y WhatsApps reales, y se
 * notaría al primer intento.
 */
