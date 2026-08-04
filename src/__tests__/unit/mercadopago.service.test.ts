import crypto from 'crypto';

/*
 * Unitario puro (sin DB / sin red) para verifyWebhookSignature — cierra parte
 * de 1.1 (C-3). Reimportamos el módulo en cada test tras mutar
 * process.env porque el valor de MP_WEBHOOK_SECRET / NODE_ENV se lee al
 * llamar la función, así que basta resetear el módulo entre casos.
 */

const ORIGINAL_ENV = { ...process.env };

function loadVerify() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../services/mercadopago.service').verifyWebhookSignature as (params: {
    dataId: string | undefined;
    xSignature: string | undefined;
    xRequestId: string | undefined;
  }) => boolean;
}

function signManifest(secret: string, dataId: string, requestId: string, ts: string) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

describe('mercadopago.service — verifyWebhookSignature', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sin secret configurado y NODE_ENV=production: rechaza (fail-closed)', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    const verifyWebhookSignature = loadVerify();

    const ok = verifyWebhookSignature({ dataId: '123', xSignature: undefined, xRequestId: 'req-1' });
    expect(ok).toBe(false);
  });

  it('sin secret configurado fuera de producción: acepta (fail-open, modo dev)', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
    const verifyWebhookSignature = loadVerify();

    const ok = verifyWebhookSignature({ dataId: '123', xSignature: undefined, xRequestId: 'req-1' });
    expect(ok).toBe(true);
  });

  it('con secret configurado y firma válida: acepta', () => {
    process.env.MP_WEBHOOK_SECRET = 'testsecret';
    process.env.NODE_ENV = 'production';
    const verifyWebhookSignature = loadVerify();

    const ts = '1700000000';
    const v1 = signManifest('testsecret', '123', 'req-1', ts);

    const ok = verifyWebhookSignature({
      dataId: '123',
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
    });
    expect(ok).toBe(true);
  });

  it('con secret configurado y firma inválida: rechaza', () => {
    process.env.MP_WEBHOOK_SECRET = 'testsecret';
    process.env.NODE_ENV = 'production';
    const verifyWebhookSignature = loadVerify();

    const ts = '1700000000';

    const ok = verifyWebhookSignature({
      dataId: '123',
      xSignature: `ts=${ts},v1=firmafalsa000000000000000000000000000000000000000000000000000000`,
      xRequestId: 'req-1',
    });
    expect(ok).toBe(false);
  });

  it('con secret configurado y sin header x-signature: rechaza', () => {
    process.env.MP_WEBHOOK_SECRET = 'testsecret';
    process.env.NODE_ENV = 'production';
    const verifyWebhookSignature = loadVerify();

    const ok = verifyWebhookSignature({ dataId: '123', xSignature: undefined, xRequestId: 'req-1' });
    expect(ok).toBe(false);
  });

  it('con secret configurado, distinto dataId al firmado: rechaza', () => {
    process.env.MP_WEBHOOK_SECRET = 'testsecret';
    process.env.NODE_ENV = 'production';
    const verifyWebhookSignature = loadVerify();

    const ts = '1700000000';
    const v1 = signManifest('testsecret', '123', 'req-1', ts);

    const ok = verifyWebhookSignature({
      dataId: '999', // distinto del firmado
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
    });
    expect(ok).toBe(false);
  });
});
