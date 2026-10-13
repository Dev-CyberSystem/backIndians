import {
  generateWelcomeCode, WELCOME_CODE_PREFIX, parseWelcomeConfig, welcomeExpiry,
  canResendCoupon, RESEND_COOLDOWN_MS, normalizeSubscriberEmail, csvCell, toCsv,
} from '../../utils/welcomeCoupon';

/*
 * Pop-up de registro con descuento (brief 06.10.2026, pedido 03): piezas puras del
 * cupón personal de bienvenida.
 */

describe('generateWelcomeCode', () => {
  it('tiene prefijo, largo fijo y solo caracteres no ambiguos', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateWelcomeCode();
      expect(code).toMatch(/^BIENVENIDA-[A-HJKMNP-Z2-9]{6}$/);
      expect(code.startsWith(WELCOME_CODE_PREFIX)).toBe(true);
    }
  });

  it('no repite códigos en una tanda grande', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateWelcomeCode()));
    expect(codes.size).toBe(2000);
  });
});

describe('parseWelcomeConfig', () => {
  it('sin configuración: apagado, 10% y 30 días', () => {
    expect(parseWelcomeConfig({})).toEqual({ enabled: false, percent: 10, validDays: 30 });
  });

  it('lee los valores guardados', () => {
    expect(parseWelcomeConfig({
      store_welcome_popup_enabled: 'true', store_welcome_discount_percent: '15', store_welcome_valid_days: '45',
    })).toEqual({ enabled: true, percent: 15, validDays: 45 });
  });

  it('solo "true" lo enciende', () => {
    for (const v of ['1', 'TRUE', 'si', '', 'false']) {
      expect(parseWelcomeConfig({ store_welcome_popup_enabled: v }).enabled).toBe(false);
    }
  });

  it('valores fuera de rango o rotos vuelven al default', () => {
    expect(parseWelcomeConfig({ store_welcome_discount_percent: '0', store_welcome_valid_days: '999' }))
      .toMatchObject({ percent: 10, validDays: 30 });
    expect(parseWelcomeConfig({ store_welcome_discount_percent: 'abc', store_welcome_valid_days: '-3' }))
      .toMatchObject({ percent: 10, validDays: 30 });
  });
});

describe('vigencia y reenvíos', () => {
  it('welcomeExpiry suma los días pedidos', () => {
    const from = new Date('2026-10-08T12:00:00Z');
    expect(welcomeExpiry(from, 30).toISOString()).toBe('2026-11-07T12:00:00.000Z');
  });

  it('canResendCoupon respeta el enfriamiento', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(canResendCoupon(null, now)).toBe(true);
    expect(canResendCoupon(new Date(now.getTime() - 10 * 60_000), now)).toBe(false);
    expect(canResendCoupon(new Date(now.getTime() - RESEND_COOLDOWN_MS), now)).toBe(true);
  });

  it('el email se guarda en minúsculas y sin espacios, sin tocar los puntos', () => {
    expect(normalizeSubscriberEmail('  Diego.Olmi@Gmail.COM ')).toBe('diego.olmi@gmail.com');
  });
});

describe('CSV', () => {
  it('escapa comillas, comas y saltos de línea', () => {
    expect(csvCell('Pérez, Juan')).toBe('"Pérez, Juan"');
    expect(csvCell('di "Dios"')).toBe('"di ""Dios"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
  });

  it('neutraliza fórmulas (el nombre lo escribe cualquier visitante)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+54911')).toBe("'+54911");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('arma header y filas', () => {
    expect(toCsv(['email', 'nombre'], [['a@x.com', 'Ana'], ['b@x.com', null]])).toBe('email,nombre\r\na@x.com,Ana\r\nb@x.com,');
  });
});
