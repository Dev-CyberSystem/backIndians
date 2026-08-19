/**
 * Constancia de arrepentimiento por mail (L-03 de la auditoría del 2026-08-19).
 *
 * La Res. 424/2020 exige que el proveedor envíe al consumidor la constancia del
 * arrepentimiento dentro de las 24 h. El envío ya estaba implementado
 * (`notifyWithdrawal` en legal.service.ts), pero NINGÚN test lo cubría — por eso
 * la auditoría concluyó que el endpoint "genera un código y no manda ningún
 * mail", y hasta lo usó para descartar el riesgo de spam. Un comportamiento que
 * nada verifica es, a los efectos prácticos, un comportamiento que nadie sabe
 * si existe.
 *
 * Este archivo cierra esa brecha: verifica que salgan los dos avisos (al
 * consumidor y al administrador), que el envío no pueda voltear una solicitud
 * ya registrada, y que el código que viaja sea el mismo que se devolvió en
 * pantalla.
 */
import { api, API } from './helpers';
import { StoreWithdrawalRequest } from '../../models';

jest.mock('../../utils/email.service', () => ({
  ...jest.requireActual('../../utils/email.service'),
  sendWithdrawalRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendWithdrawalAdminEmail: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const emails = require('../../utils/email.service') as {
  sendWithdrawalRequestEmail: jest.Mock;
  sendWithdrawalAdminEmail: jest.Mock;
};

/**
 * El aviso sale fuera de la request (`void notifyWithdrawal(...)`) para no
 * demorar la respuesta al consumidor: hay que darle al event loop la
 * oportunidad de correrlo antes de mirar el mock.
 */
async function esperarEnvio(mock: jest.Mock, intentos = 40): Promise<void> {
  for (let i = 0; i < intentos && mock.mock.calls.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function solicitar(extra: Record<string, unknown> = {}) {
  const email = `qa-arrep-mail+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const res = await api().post(`${API}/store/legal/withdrawal`).send({
    customer_name: 'Robot QA Arrepentimiento',
    customer_email: email,
    customer_phone: '1100000000',
    ...extra,
  });
  return { res, email };
}

describe('Constancia de arrepentimiento por mail — Res. 424/2020 (L-03)', () => {
  beforeEach(() => {
    emails.sendWithdrawalRequestEmail.mockClear();
    emails.sendWithdrawalAdminEmail.mockClear();
  });

  it('manda la constancia al consumidor con el mismo código que se le mostró', async () => {
    const { res, email } = await solicitar();
    expect(res.status).toBe(201);
    const code = res.body.data?.code;
    expect(code).toMatch(/^ARR-\d{4}-\d{6}$/);

    await esperarEnvio(emails.sendWithdrawalRequestEmail);
    expect(emails.sendWithdrawalRequestEmail).toHaveBeenCalledTimes(1);

    const payload = emails.sendWithdrawalRequestEmail.mock.calls[0][0];
    expect(payload.email).toBe(email);
    // El código en pantalla y el del mail tienen que ser el mismo: es el dato
    // con el que el consumidor va a reclamar.
    expect(payload.code).toBe(code);
    expect(payload.name).toBe('Robot QA Arrepentimiento');
  });

  it('incluye el número de pedido informado cuando el consumidor lo declara', async () => {
    const { res } = await solicitar({ order_number: 'ECOM-INEXISTENTE-QA' });
    expect(res.status).toBe(201);

    await esperarEnvio(emails.sendWithdrawalRequestEmail);
    expect(emails.sendWithdrawalRequestEmail.mock.calls[0][0].orderNumber).toBe('ECOM-INEXISTENTE-QA');
  });

  it('también avisa al administrador para que el reclamo no duerma', async () => {
    const { res } = await solicitar({ reason: 'No me quedó bien el talle' });
    expect(res.status).toBe(201);

    await esperarEnvio(emails.sendWithdrawalAdminEmail);
    expect(emails.sendWithdrawalAdminEmail).toHaveBeenCalledTimes(1);

    const payload = emails.sendWithdrawalAdminEmail.mock.calls[0][0];
    expect(payload.code).toBe(res.body.data.code);
    expect(payload.reason).toBe('No me quedó bien el talle');
    expect(payload.to).toBeTruthy();
  });

  it('si el mail falla, la solicitud queda registrada igual', async () => {
    // El código ya se generó y se devolvió: un proveedor de mail caído no puede
    // hacer que el consumidor pierda la constancia de su reclamo.
    emails.sendWithdrawalRequestEmail.mockRejectedValueOnce(new Error('Resend caído'));

    const { res } = await solicitar();
    expect(res.status).toBe(201);
    expect(res.body.data?.code).toMatch(/^ARR-\d{4}-\d{6}$/);

    const guardada = await StoreWithdrawalRequest.findOne({ where: { code: res.body.data.code } });
    expect(guardada).not.toBeNull();
    expect(guardada!.status).toBe('received');
  });
});
