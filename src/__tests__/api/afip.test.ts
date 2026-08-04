import * as forge from 'node-forge';
import { api, API, loginAs, auth } from './helpers';
import { Settings, Order, Invoice, Client, User } from '../../models';

/*
 * Robot de pruebas — Integración AFIP / ARCA (facturación electrónica).
 *
 * NO golpea los web services reales de AFIP (el certificado está en trámite).
 * En su lugar mockea el módulo `soap`: simula WSAA (loginCms → token/sign) y
 * WSFE (FECompUltimoAutorizado + FECAESolicitar → CAE). Esto permite validar
 * TODA la lógica propia del backend sin red ni certificado productivo:
 *
 *   1. Autenticación: arma el TRA, lo firma con node-forge (firma PKCS7 REAL) y
 *      parsea la respuesta WSAA. ← detecta si la firma/parсeo rompen en runtime.
 *   2. Cálculo del desglose IVA (neto + IVA a partir del total con IVA incluido).
 *   3. Numeración correlativa (último autorizado + 1).
 *   4. Persistencia del CAE, vencimiento, estado y tipo de comprobante.
 *   5. Rechazo de AFIP → estado 'error' + mensaje, sin romper.
 *   6. Una factura ya enviada no se reenvía.
 *   7. Permisos: un vendedor no puede enviar a AFIP.
 *   8. Stats del dashboard reflejan lo enviado.
 *
 * Requiere DB migrada + `npm run seed`.
 */

// ── Mock controlable del módulo `soap` ──────────────────────────────────────
// El prefijo `mock` es obligatorio para que jest permita referenciarlo dentro
// del factory hoisteado.
const mockState: {
  ultimoAutorizado: number;
  fecaeResponse: any;
  capturedFecaeBody: any;
  loginCalls: number;
} = {
  ultimoAutorizado: 10,
  fecaeResponse: null,
  capturedFecaeBody: null,
  loginCalls: 0,
};

jest.mock('soap', () => ({
  createClientAsync: jest.fn(async (url: string) => {
    if (url.includes('LoginCms')) {
      // WSAA
      return {
        loginCmsAsync: jest.fn(async () => {
          mockState.loginCalls++;
          const exp = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
          const xml =
            `<?xml version="1.0"?>` +
            `<loginTicketResponse>` +
            `<header><expirationTime>${exp}</expirationTime></header>` +
            `<credentials><token>TOKEN-FAKE-123</token><sign>SIGN-FAKE-456</sign></credentials>` +
            `</loginTicketResponse>`;
          return [{ loginCmsReturn: xml }];
        }),
      };
    }
    // WSFE
    return {
      FECompUltimoAutorizadoAsync: jest.fn(async () => [
        { FECompUltimoAutorizadoResult: { CbteNro: mockState.ultimoAutorizado } },
      ]),
      FECAESolicitarAsync: jest.fn(async (body: any) => {
        mockState.capturedFecaeBody = body;
        return [{ FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: mockState.fecaeResponse } } }];
      }),
    };
  }),
}));

// ── Helpers de fixtures ──────────────────────────────────────────────────────

// Crea Order + Invoice directamente por modelo (con total fijo). Se evita la API
// de pedidos a propósito: su generación de `order_number` colisiona al crear
// varios en el mismo instante, y eso es ajeno a lo que prueba el robot AFIP.
let seq = 0;
async function makeInvoice(total = 80000): Promise<number> {
  const client = await Client.findOne();
  const user = await User.findOne();
  if (!client || !user) throw new Error('Faltan cliente/usuario sembrados — corré "npm run seed".');

  const uniq = `${Date.now().toString(36)}${seq++}`;
  const order = await Order.create({
    order_number: `QA${uniq}`.slice(0, 20),
    client_id: client.id,
    created_by: user.id,
    total_amount: total,
    status: 'pending',
  });
  const invoice = await Invoice.create({
    order_id: order.id,
    invoice_number: `FAC-QA-${uniq}`,
    issue_date: new Date(),
    status: 'issued',
    total_amount: total,
  });
  return invoice.id;
}

const SEND_OK = {
  tipoComprobante: 1,        // Factura A
  concepto: 1,               // Productos
  ivaAlicuota: 21,
  docTipo: 80,               // CUIT
  docNro: '20111111112',
  condicionIvaReceptor: 1,   // Responsable Inscripto
};

// ── Suite ────────────────────────────────────────────────────────────────────

describe('AFIP / ARCA — Robot de pruebas (soap mockeado)', () => {
  let admin: string;

  beforeAll(async () => {
    admin = await loginAs('admin');

    // Certificado + clave REALES (autofirmados) para que la firma PKCS7 del TRA
    // se ejecute de verdad. 1024 bits = suficiente y rápido para un test.
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const attrs = [{ name: 'commonName', value: 'indians-test' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    process.env.AFIP_CERT_BASE64 = Buffer.from(forge.pki.certificateToPem(cert)).toString('base64');
    process.env.AFIP_KEY_BASE64 = Buffer.from(forge.pki.privateKeyToPem(keys.privateKey)).toString('base64');

    // Settings necesarios para el servicio.
    const now = new Date();
    for (const [key, value] of [
      ['company_cuit', '20111111112'],
      ['afip_punto_venta', '3'],
      ['afip_environment', 'homo'],
    ] as const) {
      await Settings.upsert({ key, value, createdAt: now, updatedAt: now });
    }
  });

  it('1. envía una factura a AFIP y persiste el CAE + numeración correlativa', async () => {
    mockState.ultimoAutorizado = 10;
    mockState.fecaeResponse = {
      Resultado: 'A',
      CAE: '71234567890123',
      CAEFchVto: '20260710',
    };

    const invoiceId = await makeInvoice();

    const res = await api()
      .post(`${API}/invoices/${invoiceId}/afip`)
      .set(...auth(admin))
      .send(SEND_OK);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.invoice.afip_status).toBe('sent');
    expect(res.body.invoice.afip_cae).toBe('71234567890123');
    expect(res.body.invoice.afip_cae_vto).toBe('2026-07-10');   // YYYYMMDD → YYYY-MM-DD
    expect(res.body.invoice.afip_cbte_nro).toBe(11);            // último(10) + 1
    expect(res.body.invoice.afip_punto_venta).toBe(3);
    expect(res.body.invoice.afip_tipo_comprobante).toBe(1);
  });

  it('2. calcula el desglose de IVA correctamente (neto + IVA sobre total con IVA incluido)', async () => {
    // Del test anterior: total 80000 @ 21% → neto 66115.70 + IVA 13884.30
    const det = mockState.capturedFecaeBody?.FeCAEReq?.FeDetReq?.FECAEDetRequest;
    expect(det).toBeTruthy();
    expect(det.ImpTotal).toBe(80000);
    expect(det.ImpNeto).toBeCloseTo(66115.70, 2);
    expect(det.ImpIVA).toBeCloseTo(13884.30, 2);
    // El neto + IVA debe reconstruir el total
    expect(det.ImpNeto + det.ImpIVA).toBeCloseTo(80000, 2);
    // Desglose de alícuota: Id 5 = 21%
    const alic = det.Iva?.AlicIva?.[0];
    expect(alic?.Id).toBe(5);
    expect(alic?.BaseImp).toBeCloseTo(66115.70, 2);
    expect(alic?.Importe).toBeCloseTo(13884.30, 2);
    // Datos del receptor y cabecera
    expect(det.DocTipo).toBe(80);
    expect(det.DocNro).toBe('20111111112');
    expect(det.CondicionIVAReceptorId).toBe(1);
    expect(mockState.capturedFecaeBody.FeCAEReq.FeCabReq.PtoVta).toBe(3);
    expect(mockState.capturedFecaeBody.FeCAEReq.FeCabReq.CbteTipo).toBe(1);
  });

  it('3. una factura ya enviada no se puede reenviar', async () => {
    mockState.ultimoAutorizado = 20;
    mockState.fecaeResponse = { Resultado: 'A', CAE: '70000000000001', CAEFchVto: '20260710' };

    const invoiceId = await makeInvoice();

    const first = await api().post(`${API}/invoices/${invoiceId}/afip`).set(...auth(admin)).send(SEND_OK);
    expect(first.status).toBe(200);

    const second = await api().post(`${API}/invoices/${invoiceId}/afip`).set(...auth(admin)).send(SEND_OK);
    expect(second.status).toBe(422);
    expect(String(second.body.error)).toMatch(/ya fue enviada/i);
  });

  it('4. si AFIP rechaza el comprobante, la factura queda en estado error con el mensaje', async () => {
    mockState.ultimoAutorizado = 30;
    mockState.fecaeResponse = {
      Resultado: 'R',
      Observaciones: { Obs: [{ Code: 10016, Msg: 'Fecha del comprobante inválida' }] },
    };

    const invoiceId = await makeInvoice();

    const res = await api().post(`${API}/invoices/${invoiceId}/afip`).set(...auth(admin)).send(SEND_OK);
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/10016/);

    // La factura quedó marcada como error (no como enviada)
    const inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
    expect(inv.body.data.afip_status).toBe('error');
    expect(inv.body.data.afip_cae).toBeFalsy();
    expect(String(inv.body.data.afip_error)).toMatch(/Fecha del comprobante/);
  });

  it('5. un vendedor no puede enviar facturas a AFIP', async () => {
    const seller = await loginAs('seller');
    mockState.ultimoAutorizado = 40;
    mockState.fecaeResponse = { Resultado: 'A', CAE: '70000000000002', CAEFchVto: '20260710' };

    const invoiceId = await makeInvoice();
    const res = await api().post(`${API}/invoices/${invoiceId}/afip`).set(...auth(seller)).send(SEND_OK);
    expect([401, 403]).toContain(res.status);
  });

  it('6. las stats del dashboard reflejan las facturas enviadas a AFIP', async () => {
    const res = await api().get(`${API}/afip/stats`).set(...auth(admin));
    expect(res.status).toBe(200);
    // Ya enviamos al menos 2 facturas A exitosas en esta corrida
    expect(res.body.grandCount).toBeGreaterThanOrEqual(2);
    expect(res.body.grandTotal).toBeGreaterThanOrEqual(160000);
    // Bucket de Factura A (tipo 1)
    expect(res.body.byTipo?.['1']?.count).toBeGreaterThanOrEqual(2);
    expect(res.body.invoices?.count).toBeGreaterThanOrEqual(2);
  });
});
