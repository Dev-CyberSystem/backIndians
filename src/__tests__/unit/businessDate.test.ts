import { businessDate, BUSINESS_TIMEZONE } from '../../utils/helpers';

/*
 * `businessDate` reemplaza a `new Date().toISOString().slice(0, 10)` en los
 * asientos automáticos de caja (ingreso de un pedido de tienda, contraasiento
 * de una reversión). `toISOString()` devuelve la fecha UTC y Tucumán es UTC−3,
 * así que todo lo registrado entre las 21:00 y la medianoche local quedaba
 * fechado al día siguiente: el movimiento caía en la jornada equivocada y
 * descuadraba el resumen diario y cualquier corte por fecha.
 *
 * El caso solo se manifiesta en esa ventana de tres horas, por eso se prueba
 * con instantes fijos y no con "ahora" — con la hora del reloj, el test pasaría
 * el 90% del día aun con el defecto vivo.
 */

describe('businessDate — jornada del negocio en zona horaria operativa', () => {
  it('usa la zona horaria del negocio, no UTC', () => {
    expect(BUSINESS_TIMEZONE).toBe('America/Argentina/Tucuman');
  });

  it('a las 22:30 de Tucumán la jornada sigue siendo la del mismo día', () => {
    // 2026-08-07 22:30 ART == 2026-08-08 01:30 UTC
    const instant = new Date('2026-08-08T01:30:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-08'); // lo que hacía antes
    expect(businessDate(instant)).toBe('2026-08-07');              // lo que corresponde
  });

  it('a las 23:59 de Tucumán todavía no cambió la jornada', () => {
    expect(businessDate(new Date('2026-08-08T02:59:00.000Z'))).toBe('2026-08-07');
  });

  it('a las 00:01 de Tucumán la jornada ya es la nueva', () => {
    expect(businessDate(new Date('2026-08-08T03:01:00.000Z'))).toBe('2026-08-08');
  });

  it('al mediodía coincide con UTC y no rompe el caso normal', () => {
    const instant = new Date('2026-08-07T15:00:00.000Z'); // 12:00 ART
    expect(businessDate(instant)).toBe('2026-08-07');
    expect(businessDate(instant)).toBe(instant.toISOString().slice(0, 10));
  });

  it('devuelve siempre formato YYYY-MM-DD', () => {
    expect(businessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('no depende de la zona horaria del proceso', () => {
    // Railway corre en UTC y la máquina de desarrollo no: el resultado tiene
    // que ser el mismo en ambas.
    const previous = process.env.TZ;
    const instant = new Date('2026-08-08T01:30:00.000Z');
    try {
      process.env.TZ = 'UTC';
      const asUtc = businessDate(instant);
      process.env.TZ = 'Europe/Madrid';
      const asMadrid = businessDate(instant);
      expect(asUtc).toBe('2026-08-07');
      expect(asMadrid).toBe(asUtc);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
