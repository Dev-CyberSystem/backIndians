import { storeOrderDateKey } from '../../services/store.service';

/*
 * El número de pedido de tienda es `ECOM-YYYYMMDD-NNNN`. Ese `YYYYMMDD` salía de
 * `new Date().getDate()` — hora del servidor, que en producción (Railway) es
 * UTC. Como Tucumán es UTC−3, todo pedido hecho entre las 21:00 y la medianoche
 * local quedaba fechado al día siguiente (caso real en producción:
 * `ECOM-20260905-0002` para un pedido del 2026-09-04 22:13 ART) y además sumaba
 * a la secuencia `NNNN` de la jornada equivocada.
 *
 * Como el defecto solo aparece en esa ventana de tres horas, se prueba con
 * instantes fijos y no con "ahora".
 */

describe('storeOrderDateKey — fecha del número de pedido en la jornada del negocio', () => {
  it('a las 22:13 de Tucumán usa la fecha local, no la del día siguiente en UTC', () => {
    // 2026-09-04 22:13 ART == 2026-09-05 01:13 UTC (el caso de producción)
    const instant = new Date('2026-09-05T01:13:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-05'); // lo que hacía antes
    expect(storeOrderDateKey(instant)).toBe('20260904');           // lo que corresponde
  });

  it('a las 23:59 de Tucumán todavía no cambió la jornada', () => {
    expect(storeOrderDateKey(new Date('2026-09-05T02:59:00.000Z'))).toBe('20260904');
  });

  it('a las 00:01 de Tucumán la jornada ya es la nueva', () => {
    expect(storeOrderDateKey(new Date('2026-09-05T03:01:00.000Z'))).toBe('20260905');
  });

  it('al mediodía coincide con la fecha UTC y no rompe el caso normal', () => {
    expect(storeOrderDateKey(new Date('2026-09-04T15:00:00.000Z'))).toBe('20260904');
  });

  it('devuelve siempre 8 dígitos', () => {
    expect(storeOrderDateKey()).toMatch(/^\d{8}$/);
  });

  it('no depende de la zona horaria del proceso', () => {
    const previous = process.env.TZ;
    const instant = new Date('2026-09-05T01:13:00.000Z');
    try {
      process.env.TZ = 'UTC';
      const asUtc = storeOrderDateKey(instant);
      process.env.TZ = 'Europe/Madrid';
      const asMadrid = storeOrderDateKey(instant);
      expect(asUtc).toBe('20260904');
      expect(asMadrid).toBe(asUtc);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
