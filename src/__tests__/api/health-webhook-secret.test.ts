import { api } from './helpers';

/*
 * `/health` reporta si `MP_WEBHOOK_SECRET` está cargado en el proceso.
 *
 * Por qué existe este test (C1 / DEC-014): la rebaja temporal del 2026-08-07 se
 * mantuvo doce días en parte porque **no había forma de saber desde afuera si la
 * variable estaba cargada**. `verifyWebhookSignature` devuelve `false` tanto si
 * falta el secreto como si la firma es inválida —correcto por seguridad, inútil
 * para diagnosticar—, así que la única evidencia era la ausencia de una línea en
 * los logs de Railway, y una ausencia sólo prueba algo si sabés que la verías.
 *
 * Lo que se verifica acá es lo que hace confiable a ese indicador: que refleje
 * el estado real del entorno y que **nunca exponga el valor**. Un `/health`
 * público filtrando el secreto del webhook sería bastante peor que el problema
 * que vino a resolver.
 */

const SECRET_SENTINEL = 'valor-de-prueba-que-no-debe-aparecer-jamas';

describe('/health — estado de MP_WEBHOOK_SECRET', () => {
  const original = process.env.MP_WEBHOOK_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.MP_WEBHOOK_SECRET;
    else process.env.MP_WEBHOOK_SECRET = original;
  });

  it('reporta webhook_secret: true cuando la variable está cargada', async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET_SENTINEL;

    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data.webhook_secret).toBe(true);
  });

  it('reporta webhook_secret: false cuando falta', async () => {
    delete process.env.MP_WEBHOOK_SECRET;

    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.data.webhook_secret).toBe(false);
  });

  it('nunca devuelve el valor del secreto, sólo el booleano', async () => {
    process.env.MP_WEBHOOK_SECRET = SECRET_SENTINEL;

    const res = await api().get('/health');

    // Sobre el cuerpo serializado entero: alcanza con que se cuele en cualquier
    // campo nuevo que alguien agregue más adelante para que esto falle.
    expect(JSON.stringify(res.body)).not.toContain(SECRET_SENTINEL);
    expect(typeof res.body.data.webhook_secret).toBe('boolean');
  });

  it('una cadena vacía cuenta como "no configurado"', async () => {
    // Railway permite guardar una variable con valor vacío, y eso es
    // indistinguible de no tenerla para `verifyWebhookSignature` (`!secret`).
    // El indicador tiene que decir lo mismo que el código que valida la firma,
    // o miente justo en el caso que más confunde.
    process.env.MP_WEBHOOK_SECRET = '';

    const res = await api().get('/health');

    expect(res.body.data.webhook_secret).toBe(false);
  });
});
