/**
 * Guarda de envío de mails.
 *
 * Origen: el 2026-08-08 una jornada de pruebas mandó más de 100 mails reales a
 * direcciones `@test.local` que rebotaron todas, dañando la reputación del
 * dominio. Estos tests son la red que evita que vuelva a pasar.
 */
import { mailBlockedReason, guardedSend } from '../../utils/mailGuard';

describe('mailGuard — a quién NO se le manda un mail', () => {
  const originalJestId = process.env.JEST_WORKER_ID;

  afterEach(() => {
    process.env.JEST_WORKER_ID = originalJestId;
    delete process.env.MAIL_ENABLED;
  });

  it('bajo Jest no se envía nada, sea quien sea el destinatario', () => {
    expect(mailBlockedReason('cliente.real@gmail.com')).toBe('suite de tests (Jest)');
  });

  describe('fuera de Jest', () => {
    beforeEach(() => {
      delete process.env.JEST_WORKER_ID;
    });

    it('bloquea los dominios de prueba que usaron los E2E', () => {
      // Estas son las direcciones exactas que rebotaron.
      expect(mailBlockedReason('qa-talle+1786242109314@test.local')).toMatch(/dominio de prueba/);
      expect(mailBlockedReason('qa-webhook+123@test.local')).toMatch(/dominio de prueba/);
      expect(mailBlockedReason('lucia.fernandez@example.com')).toMatch(/dominio de prueba/);
    });

    it('bloquea también los subdominios de un dominio de prueba', () => {
      expect(mailBlockedReason('alguien@mail.test.local')).toMatch(/dominio de prueba/);
    });

    it('bloquea si CUALQUIERA de los destinatarios es de prueba', () => {
      expect(mailBlockedReason(['real@gmail.com', 'qa@test.local'])).toMatch(/dominio de prueba/);
    });

    it('bloquea direcciones sin dominio', () => {
      expect(mailBlockedReason('no-es-un-mail')).toBeTruthy();
    });

    it('MAIL_ENABLED=0 corta todo', () => {
      process.env.MAIL_ENABLED = '0';
      expect(mailBlockedReason('cliente.real@gmail.com')).toBe('MAIL_ENABLED=0');
    });

    it('a un cliente real SÍ se le manda (no corregir de más)', () => {
      expect(mailBlockedReason('cliente.real@gmail.com')).toBeNull();
      expect(mailBlockedReason('comprador@indians.com.ar')).toBeNull();
    });
  });
});

describe('guardedSend — no llama al proveedor cuando está bloqueado', () => {
  it('no ejecuta el envío y devuelve false', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    // Bajo Jest siempre está bloqueado.
    const sent = await guardedSend('cualquiera@gmail.com', 'Asunto', send);

    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
