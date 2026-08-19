import { api, API, loginAs, auth } from './helpers';
import { PUBLIC_SETTING_KEYS, VALID_KEYS } from '../../services/settings.service';
import { Settings } from '../../models';
import { invalidateCache } from '../../utils/cache';

/**
 * Escribe una clave directo en la tabla, sin pasar por `PUT /settings`.
 *
 * A propósito: el endpoint de administración valida (por ejemplo, rechaza un
 * `store_cash_account_id` que no apunte a una cuenta de tipo `cash`), y acá el
 * punto no es que el valor sea válido sino que la clave NO viaje al público.
 */
async function setRaw(key: string, value: string): Promise<void> {
  const now = new Date();
  await Settings.upsert({ key, value, createdAt: now, updatedAt: now });
}

/*
 * GET /store/settings es público, sin autenticación y cacheado 60s como
 * `public`: todo lo que devuelve queda expuesto en internet (S-01 de la
 * auditoría del 2026-08-19).
 *
 * Hasta el 2026-08-19 hacía `Settings.findAll()` sin `where` y publicaba las 75
 * claves de la tabla. El defecto no era el contenido de ese día —era que
 * funcionaba como lista negra por omisión: el día que se agregue una credencial
 * de courier a VALID_KEYS (Andreani está en el backlog), quedaría publicada sin
 * que nadie toque el endpoint.
 *
 * Este archivo es el que tiene que fallar ese día.
 */

describe('GET /store/settings — allowlist de claves públicas (S-01)', () => {
  let admin: string;
  /** Valor original de cada clave que este archivo pisa, para devolverlo al final. */
  const originales = new Map<string, string | null>();

  beforeAll(async () => {
    admin = await loginAs('admin');
  });

  afterAll(async () => {
    // Obligatorio: la suite corre serial contra la DB de desarrollo y varias de
    // estas claves las usa la lógica de negocio (`shipping_cost` entra en el
    // cálculo del total del checkout). Dejarlas con los valores de prueba haría
    // fallar a las suites que corran después, por un motivo imposible de rastrear.
    for (const [key, value] of originales) {
      if (value === null) {
        await Settings.destroy({ where: { key } });
      } else {
        await setRaw(key, value);
      }
    }
    invalidateCache('store:settings');
  });

  /** Igual que setRaw, pero guardando el valor anterior para restaurarlo al final. */
  async function setTemp(key: string, value: string): Promise<void> {
    if (!originales.has(key)) {
      const row = await Settings.findByPk(key);
      originales.set(key, row ? row.value ?? '' : null);
    }
    await setRaw(key, value);
  }

  async function publicSettings(): Promise<Record<string, string>> {
    // El endpoint cachea 60s: sin invalidar, un test podría leer la respuesta
    // que armó otro antes de tocar la configuración.
    invalidateCache('store:settings');
    const res = await api().get(`${API}/store/settings`);
    expect(res.status).toBe(200);
    return (res.body?.data ?? res.body) as Record<string, string>;
  }

  it('no devuelve ninguna clave que no esté en PUBLIC_SETTING_KEYS', async () => {
    const filtradas = Object.keys(await publicSettings()).filter((k) => !PUBLIC_SETTING_KEYS.includes(k));
    expect(filtradas).toEqual([]);
  });

  it('no filtra configuración interna: cuentas de caja, AFIP ni datos de facturación', async () => {
    // Se cargan valores reconocibles para que el test falle por lo que importa
    // (la clave viaja) y no por que en esta base esté vacía.
    const internas = [
      'store_cash_account_id', 'store_bank_account_id',
      'afip_enabled', 'afip_environment', 'afip_punto_venta', 'afip_concepto_default',
      'invoice_due_days', 'invoice_point_of_sale', 'invoice_default_type',
      'company_activity_start', 'company_website',
    ];
    for (const key of internas) {
      await setTemp(key, `INTERNO-${key}`);
    }

    const settings = await publicSettings();
    for (const key of internas) {
      expect(settings).not.toHaveProperty(key);
    }
    expect(JSON.stringify(settings)).not.toContain('INTERNO-');
  });

  it('sigue publicando lo que los textos legales necesitan — recortar de más incumple la Res. 104/2005', async () => {
    // useLegalInfo.ts arma con estas claves la identificación del titular que
    // la normativa obliga a publicar. Si dejan de viajar, los tres documentos
    // legales muestran "—" donde va el domicilio, el CUIT o el contacto.
    for (const key of ['company_name', 'company_cuit', 'company_address', 'company_email', 'company_phone', 'company_iva_condition']) {
      await setTemp(key, `dato-${key}`);
    }
    await setTemp('store_data_fiscal_url', 'https://afip.gob.ar/qr-de-prueba');

    const settings = await publicSettings();
    for (const key of ['company_name', 'company_cuit', 'company_address', 'company_email', 'company_phone', 'company_iva_condition']) {
      expect(settings[key]).toBe(`dato-${key}`);
    }
    expect(settings.store_data_fiscal_url).toBe('https://afip.gob.ar/qr-de-prueba');
  });

  it('sigue publicando los datos bancarios — sin ellos el comprador no puede transferir', async () => {
    const bancarias = ['bank_transfer_cbu', 'bank_transfer_alias', 'bank_transfer_holder'];
    for (const key of bancarias) await setTemp(key, `banco-${key}`);

    const settings = await publicSettings();
    for (const key of bancarias) {
      expect(PUBLIC_SETTING_KEYS).toContain(key);
      expect(settings[key]).toBe(`banco-${key}`);
    }
  });

  it('sigue publicando el bloque de la landing y del layout de la tienda', async () => {
    const dePantalla = [
      'store_name', 'store_logo_url', 'store_primary_color', 'store_announcement',
      'store_hero_title', 'store_marquee', 'store_whatsapp',
      'store_chatbot_enabled', 'shipping_cost',
    ];
    for (const key of dePantalla) await setTemp(key, `visible-${key}`);

    const settings = await publicSettings();
    for (const key of dePantalla) {
      expect(settings[key]).toBe(`visible-${key}`);
    }
  });

  it('el endpoint interno de settings sí devuelve más claves que el público', async () => {
    // Confirma que la diferencia es real y no que ambas listas quedaron iguales
    // por accidente (que dejaría este archivo pasando sin proteger nada).
    const interno = await api().get(`${API}/settings`).set(...auth(admin));
    expect(interno.status).toBe(200);
    const internas = Object.keys(interno.body?.data ?? {});
    const publicas = Object.keys(await publicSettings());
    expect(internas.length).toBeGreaterThan(publicas.length);
    expect(internas).toContain('store_cash_account_id');
  });

  it('toda clave pública tiene que ser una clave válida de settings', () => {
    // Una clave en PUBLIC_SETTING_KEYS que no esté en VALID_KEYS nunca podría
    // guardarse desde el panel: sería una promesa que el sistema no cumple.
    const huerfanas = PUBLIC_SETTING_KEYS.filter((k) => !VALID_KEYS.includes(k));
    expect(huerfanas).toEqual([]);
  });

  it('la allowlist pública es estrictamente más chica que el total de claves', () => {
    // Si alguien "arregla" un test copiando VALID_KEYS acá, esto lo frena.
    expect(PUBLIC_SETTING_KEYS.length).toBeLessThan(VALID_KEYS.length);
    for (const interna of ['store_cash_account_id', 'store_bank_account_id', 'afip_enabled', 'invoice_default_type']) {
      expect(PUBLIC_SETTING_KEYS).not.toContain(interna);
    }
  });
});
