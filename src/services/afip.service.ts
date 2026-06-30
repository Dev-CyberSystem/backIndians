import * as forge from 'node-forge';
import * as soap from 'soap';
import { Invoice, CatalogInvoice, StoreOrder } from '../models';
import { getAllSettings } from './settings.service';

// ─── AFIP codes ──────────────────────────────────────────────────────────────

export const AFIP_TIPO_COMPROBANTE = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
} as const;

export const AFIP_TIPO_LABELS: Record<number, string> = {
  1:  'Factura A',
  6:  'Factura B',
  11: 'Factura C',
};

export const AFIP_CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

export const AFIP_CONCEPTO_LABELS: Record<number, string> = {
  1: 'Productos',
  2: 'Servicios',
  3: 'Productos y Servicios',
};

export const AFIP_DOC_TIPO = {
  CUIT:      80,
  DNI:       96,
  NO_INDICA: 99,
} as const;

export const AFIP_CONDICION_IVA = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO:                4,
  CONSUMIDOR_FINAL:      5,
  MONOTRIBUTISTA:        6,
} as const;

export const AFIP_CONDICION_IVA_LABELS: Record<number, string> = {
  1: 'Responsable Inscripto',
  4: 'Exento',
  5: 'Consumidor Final',
  6: 'Monotributista',
};

// IVA aliquot IDs for FECAESolicitar
const IVA_ID_MAP: Record<number, number> = {
  0:    3,  // 0%
  10.5: 4,  // 10.5%
  21:   5,  // 21%
};

// ─── WSAA URLs ───────────────────────────────────────────────────────────────

const WSAA_URL = {
  homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl',
};

const WSFE_URL = {
  homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?wsdl',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?wsdl',
};

// ─── Token cache ─────────────────────────────────────────────────────────────

interface AfipTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

const ticketCache: Record<string, AfipTicket> = {};

// ─── Auth ─────────────────────────────────────────────────────────────────────

function buildTraXml(): string {
  const now = new Date();
  const gen = new Date(now.getTime() - 10 * 60 * 1000);
  const exp = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const toAfipDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '-03:00');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${toAfipDate(gen)}</generationTime>` +
    `<expirationTime>${toAfipDate(exp)}</expirationTime>` +
    `</header>` +
    `<service>wsfe</service>` +
    `</loginTicketRequest>`
  );
}

function signTra(traXml: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [],
  });
  p7.sign({ detached: false });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function extractXmlTag(xml: string, tag: string): string {
  // Nota: regex construida por concatenación, NO template literal — en un
  // template literal `[\s\S]` colapsa a `[sS]` (JS descarta los backslashes).
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  if (!m) throw new Error(`WSAA: tag <${tag}> not found in response`);
  return m[1].trim();
}

async function getAuthTicket(env: 'homo' | 'prod'): Promise<AfipTicket> {
  const cached = ticketCache[env];
  if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return cached;
  }

  const certB64 = process.env.AFIP_CERT_BASE64;
  const keyB64  = process.env.AFIP_KEY_BASE64;
  if (!certB64 || !keyB64) {
    throw new Error('AFIP_CERT_BASE64 y AFIP_KEY_BASE64 no están configuradas en las variables de entorno');
  }

  const certPem = Buffer.from(certB64, 'base64').toString('utf8');
  const keyPem  = Buffer.from(keyB64,  'base64').toString('utf8');

  const traXml   = buildTraXml();
  const cmsSigned = signTra(traXml, certPem, keyPem);

  const client = await soap.createClientAsync(WSAA_URL[env], { disableCache: true });
  const [result] = await client.loginCmsAsync({ in0: cmsSigned });
  const responseXml: string = result?.loginCmsReturn ?? '';

  const token = extractXmlTag(responseXml, 'token');
  const sign  = extractXmlTag(responseXml, 'sign');
  const expStr = extractXmlTag(responseXml, 'expirationTime');

  const ticket: AfipTicket = { token, sign, expiresAt: new Date(expStr) };
  ticketCache[env] = ticket;
  return ticket;
}

// ─── WSFE helpers ────────────────────────────────────────────────────────────

async function getWsfeClient(env: 'homo' | 'prod') {
  return soap.createClientAsync(WSFE_URL[env], { disableCache: true });
}

async function getNextCbteNro(
  client: soap.Client,
  cuit: string,
  ticket: AfipTicket,
  puntoVenta: number,
  tipoComprobante: number
): Promise<number> {
  const [res] = await client.FECompUltimoAutorizadoAsync({
    Auth: { Token: ticket.token, Sign: ticket.sign, Cuit: cuit },
    PtoVta: puntoVenta,
    CbteTipo: tipoComprobante,
  });
  const last = Number(res?.FECompUltimoAutorizadoResult?.CbteNro ?? 0);
  return last + 1;
}

// ─── IVA breakdown calculation ───────────────────────────────────────────────

function calcIvaBreakdown(total: number, alicuota: number) {
  if (alicuota === 0) {
    // 0% IVA: full amount is "neto gravado"
    return { ImpNeto: total, ImpIVA: 0, ImpOpEx: 0, ImpTrib: 0, ivaArray: [{ Id: 3, BaseImp: total, Importe: 0 }] };
  }
  const factor = alicuota / 100;
  const neto   = parseFloat((total / (1 + factor)).toFixed(2));
  const iva    = parseFloat((total - neto).toFixed(2));
  const ivaId  = IVA_ID_MAP[alicuota] ?? 5;
  return {
    ImpNeto: neto,
    ImpIVA:  iva,
    ImpOpEx: 0,
    ImpTrib: 0,
    ivaArray: [{ Id: ivaId, BaseImp: neto, Importe: iva }],
  };
}

// ─── Params ─────────────────────────────────────────────────────────────────

export interface AfipSendParams {
  tipoComprobante: number;
  concepto:        number;
  ivaAlicuota:     number;
  docTipo:         number;
  docNro:          string;
  condicionIvaReceptor: number;
  totalAmount:     number;
}

// ─── Core: send to AFIP ──────────────────────────────────────────────────────

async function sendToAfip(params: AfipSendParams): Promise<{
  cae: string;
  caeVto: string;
  cbteNro: number;
  puntoVenta: number;
}> {
  const settings   = await getAllSettings();
  const env        = (settings.afip_environment as 'homo' | 'prod') || 'homo';
  const cuit       = (settings.company_cuit || '').replace(/[-\s]/g, '');
  const puntoVenta = parseInt(settings.afip_punto_venta || '0', 10);

  if (!cuit)       throw new Error('company_cuit no configurado en settings');
  if (!puntoVenta) throw new Error('afip_punto_venta no configurado en settings');

  const ticket     = await getAuthTicket(env);
  const wsfeClient = await getWsfeClient(env);
  const cbteNro    = await getNextCbteNro(wsfeClient, cuit, ticket, puntoVenta, params.tipoComprobante);

  const { ImpNeto, ImpIVA, ImpOpEx, ImpTrib, ivaArray } = calcIvaBreakdown(params.totalAmount, params.ivaAlicuota);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const body = {
    Auth: { Token: ticket.token, Sign: ticket.sign, Cuit: cuit },
    FeCAEReq: {
      FeCabReq: {
        CantReg:  1,
        PtoVta:   puntoVenta,
        CbteTipo: params.tipoComprobante,
      },
      FeDetReq: {
        FECAEDetRequest: {
          Concepto:              params.concepto,
          DocTipo:               params.docTipo,
          DocNro:                params.docNro.replace(/[-\s]/g, '') || '0',
          CbteDesde:             cbteNro,
          CbteHasta:             cbteNro,
          CbteFch:               today,
          ImpTotal:              params.totalAmount,
          ImpTotConc:            0,
          ImpNeto,
          ImpOpEx,
          ImpIVA,
          ImpTrib,
          MonId:                 'PES',
          MonCotiz:              1,
          CondicionIVAReceptorId: params.condicionIvaReceptor,
          Iva: { AlicIva: ivaArray },
        },
      },
    },
  };

  const [res] = await wsfeClient.FECAESolicitarAsync(body);
  const det   = res?.FECAESolicitarResult?.FeDetResp?.FECAEDetResponse;

  if (!det) throw new Error('AFIP no devolvió respuesta de comprobante');

  const resultado = det.Resultado;
  if (resultado !== 'A') {
    const obs = det.Observaciones?.Obs;
    const msgs = Array.isArray(obs) ? obs.map((o: any) => `${o.Code}: ${o.Msg}`).join('; ') : String(obs ?? 'Error desconocido');
    throw new Error(`AFIP rechazó el comprobante: ${msgs}`);
  }

  return {
    cae:         det.CAE,
    caeVto:      String(det.CAEFchVto).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    cbteNro,
    puntoVenta,
  };
}

// ─── Public methods ──────────────────────────────────────────────────────────

export async function sendInvoiceToAfip(invoiceId: number, params: AfipSendParams): Promise<Invoice> {
  const invoice = await Invoice.findByPk(invoiceId);
  if (!invoice) throw new Error('Factura no encontrada');
  if (invoice.afip_status === 'sent') throw new Error('Esta factura ya fue enviada a AFIP');

  await invoice.update({ afip_status: 'pending' });

  try {
    const result = await sendToAfip({ ...params, totalAmount: Number(invoice.total_amount ?? 0) });
    return await invoice.update({
      afip_status:                'sent',
      afip_tipo_comprobante:      params.tipoComprobante,
      afip_concepto:              params.concepto,
      afip_iva_alicuota:          params.ivaAlicuota,
      afip_doc_tipo:              params.docTipo,
      afip_condicion_iva_receptor: params.condicionIvaReceptor,
      afip_punto_venta:           result.puntoVenta,
      afip_cbte_nro:              result.cbteNro,
      afip_cae:                   result.cae,
      afip_cae_vto:               result.caeVto,
      afip_sent_at:               new Date(),
      afip_error:                 null,
    });
  } catch (err: any) {
    await invoice.update({ afip_status: 'error', afip_error: err.message });
    throw err;
  }
}

export async function sendCatalogInvoiceToAfip(invoiceId: number, params: AfipSendParams): Promise<CatalogInvoice> {
  const invoice = await CatalogInvoice.findByPk(invoiceId);
  if (!invoice) throw new Error('Factura de catálogo no encontrada');
  if (invoice.afip_status === 'sent') throw new Error('Esta factura ya fue enviada a AFIP');

  await invoice.update({ afip_status: 'pending' });

  try {
    const result = await sendToAfip({ ...params, totalAmount: Number(invoice.total_amount ?? 0) });
    return await invoice.update({
      afip_status:                'sent',
      afip_tipo_comprobante:      params.tipoComprobante,
      afip_concepto:              params.concepto,
      afip_iva_alicuota:          params.ivaAlicuota,
      afip_doc_tipo:              params.docTipo,
      afip_condicion_iva_receptor: params.condicionIvaReceptor,
      afip_punto_venta:           result.puntoVenta,
      afip_cbte_nro:              result.cbteNro,
      afip_cae:                   result.cae,
      afip_cae_vto:               result.caeVto,
      afip_sent_at:               new Date(),
      afip_error:                 null,
    });
  } catch (err: any) {
    await invoice.update({ afip_status: 'error', afip_error: err.message });
    throw err;
  }
}

export async function sendStoreOrderToAfip(orderId: number, params: AfipSendParams): Promise<StoreOrder> {
  const order = await StoreOrder.findByPk(orderId);
  if (!order) throw new Error('Pedido de tienda no encontrado');
  if (order.afip_status === 'sent') throw new Error('Este pedido ya fue enviado a AFIP');

  await order.update({ afip_status: 'pending' });

  try {
    const result = await sendToAfip({ ...params, totalAmount: Number(order.total_amount ?? 0) });
    return await order.update({
      afip_status:                'sent',
      afip_tipo_comprobante:      params.tipoComprobante,
      afip_concepto:              params.concepto,
      afip_iva_alicuota:          params.ivaAlicuota,
      afip_doc_tipo:              params.docTipo,
      afip_condicion_iva_receptor: params.condicionIvaReceptor,
      afip_punto_venta:           result.puntoVenta,
      afip_cbte_nro:              result.cbteNro,
      afip_cae:                   result.cae,
      afip_cae_vto:               result.caeVto,
      afip_sent_at:               new Date(),
      afip_error:                 null,
    });
  } catch (err: any) {
    await order.update({ afip_status: 'error', afip_error: err.message });
    throw err;
  }
}

// ─── Dashboard stats ─────────────────────────────────────────────────────────

export interface AfipStats {
  invoices:       { count: number; total: number };
  catalogInvoices:{ count: number; total: number };
  storeOrders:    { count: number; total: number };
  byTipo: Record<number, { count: number; total: number }>;
  grandTotal: number;
  grandCount: number;
}

export async function getAfipStats(): Promise<AfipStats> {
  const [invRows, catRows, storeRows] = await Promise.all([
    Invoice.findAll({
      where: { afip_status: 'sent' },
      attributes: ['afip_tipo_comprobante', 'total_amount'],
    }),
    CatalogInvoice.findAll({
      where: { afip_status: 'sent' },
      attributes: ['afip_tipo_comprobante', 'total_amount'],
    }),
    StoreOrder.findAll({
      where: { afip_status: 'sent' },
      attributes: ['afip_tipo_comprobante', 'total_amount'],
    }),
  ]);

  const allRows = [
    ...invRows.map((r) => ({ tipo: r.afip_tipo_comprobante, amount: Number(r.total_amount ?? 0) })),
    ...catRows.map((r) => ({ tipo: r.afip_tipo_comprobante, amount: Number(r.total_amount ?? 0) })),
    ...storeRows.map((r) => ({ tipo: r.afip_tipo_comprobante, amount: Number(r.total_amount ?? 0) })),
  ];

  const byTipo: Record<number, { count: number; total: number }> = {};
  for (const r of allRows) {
    const k = r.tipo ?? 0;
    if (!byTipo[k]) byTipo[k] = { count: 0, total: 0 };
    byTipo[k].count++;
    byTipo[k].total += r.amount;
  }

  const sumRows = (rows: { total_amount?: number | null }[]) =>
    rows.reduce((acc, r) => ({ count: acc.count + 1, total: acc.total + Number(r.total_amount ?? 0) }), { count: 0, total: 0 });

  return {
    invoices:        sumRows(invRows),
    catalogInvoices: sumRows(catRows),
    storeOrders:     sumRows(storeRows),
    byTipo,
    grandCount: allRows.length,
    grandTotal:  allRows.reduce((s, r) => s + r.amount, 0),
  };
}
