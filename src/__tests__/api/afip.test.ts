import * as forge from "node-forge";
import { randomUUID, createHash } from "crypto";
import { api, API, loginAs, auth } from "./helpers";
import {
  Settings,
  Order,
  Invoice,
  Client,
  User,
  CatalogOrder,
  CatalogInvoice,
  StoreOrder,
  OrderItem,
  GarmentType,
  CatalogProduct,
  CatalogOrderItem,
  StoreOrderItem,
} from "../../models";
import { AfipDocument, AfipAuthTicket } from "../../models/AfipDocument";
import { withAfipLock } from "../../services/afip.transport";
import {
  buildTraXml,
  buildDetail,
  validateParams,
  matches,
} from "../../services/afip.protocol";
import { fiscalQrPayload } from "../../utils/afip.pdf";

const mockState = {
  last: new Map<string, number>(),
  remote: new Map<string, any>(),
  calls: 0,
  loginCalls: 0,
  failAfter: false,
  reject: false,
  invalidLast: false,
  delay: false,
  globalError: false,
};
jest.mock("soap", () => ({
  createClientAsync: jest.fn(async (url: string) => {
    const env = url.includes("homo") ? "homo" : "prod";
    if (url.includes("LoginCms"))
      return {
        loginCmsAsync: async () => {
          mockState.loginCalls++;
          return [
            {
              loginCmsReturn:
                "<loginTicketResponse><expirationTime>" +
                new Date(Date.now() + 3600000).toISOString() +
                "</expirationTime><token>TEST</token><sign>TEST-SIGN</sign></loginTicketResponse>",
            },
          ];
        },
      };
    const result = (name: string, value: any) => [{ [name + "Result"]: value }];
    return {
      FEParamGetTiposCbteAsync: async () =>
        result("FEParamGetTiposCbte", {
          ResultGet: { CbteTipo: [1, 6, 11, 3, 8, 13].map((Id) => ({ Id })) },
        }),
      FEParamGetPtosVentaAsync: async () =>
        result("FEParamGetPtosVenta", {
          ResultGet: {
            PtoVenta: [{ Nro: 9998, Bloqueado: "N", FchBaja: "NULL" }],
          },
        }),
      FEParamGetCondicionIvaReceptorAsync: async () =>
        result("FEParamGetCondicionIvaReceptor", {
          ResultGet: {
            CondicionIvaReceptor: [1, 4, 5, 6].map((Id) => ({ Id })),
          },
        }),
      FECompUltimoAutorizadoAsync: async (a: any) =>
        result(
          "FECompUltimoAutorizado",
          mockState.invalidLast
            ? { Errors: { Err: [{ Code: 500, Msg: "last unavailable" }] } }
            : { CbteNro: mockState.last.get(env + ":" + a.CbteTipo) || 0 },
        ),
      FECompConsultarAsync: async (a: any) => {
        const q = a.FeCompConsReq;
        const found = mockState.remote.get(
          env + ":" + q.CbteTipo + ":" + q.CbteNro,
        );
        return result(
          "FECompConsultar",
          found
            ? { ResultGet: found }
            : { Errors: { Err: [{ Code: 602, Msg: "No existe" }] } },
        );
      },
      FECAESolicitarAsync: async (a: any) => {
        mockState.calls++;
        if (mockState.delay) await new Promise((r) => setTimeout(r, 150));
        const h = a.FeCAEReq.FeCabReq,
          d = a.FeCAEReq.FeDetReq.FECAEDetRequest[0],
          key = env + ":" + h.CbteTipo;
        if (mockState.globalError)
          return result("FECAESolicitar", {
            Errors: { Err: [{ Code: 500, Msg: "error global" }] },
          });
        if (mockState.reject)
          return result("FECAESolicitar", {
            FeDetResp: {
              FECAEDetResponse: [
                {
                  Resultado: "R",
                  Observaciones: {
                    Obs: { Code: 10016, Msg: "Fecha inválida" },
                  },
                },
              ],
            },
          });
        mockState.last.set(key, d.CbteDesde);
        const accepted = {
          ...d,
          PtoVta: h.PtoVta,
          CbteTipo: h.CbteTipo,
          Resultado: "A",
          CAE: "71234567890123",
          CAEFchVto: "20260930",
          CodAutorizacion: "71234567890123",
          FchVto: "20260930",
          EmisionTipo: "CAE",
        };
        mockState.remote.set(key + ":" + d.CbteDesde, accepted);
        if (mockState.failAfter) {
          mockState.failAfter = false;
          throw new Error("connection lost");
        }
        return result("FECAESolicitar", {
          FeDetResp: { FECAEDetResponse: [accepted] },
        });
      },
    };
  }),
}));
let seq = 0;
const targets: Array<{ target: string; id: number }> = [];
const saved = new Map<string, string | null>();
const testSettings = {
  company_cuit: "20111111112",
  company_name: "Emisor QA",
  company_address: "Calle QA 123",
  company_iibb: "Exento",
  company_activity_start: "01/01/2020",
  company_iva_condition: "Responsable Inscripto",
  afip_punto_venta: "9998",
  afip_environment: "homo",
  afip_enabled: "true",
};
const p = {
  tipoComprobante: 1,
  concepto: 1,
  ivaAlicuota: 21,
  docTipo: 80,
  docNro: "20111111112",
  condicionIvaReceptor: 1,
  receptorNombre: "Receptor QA",
  receptorDomicilio: "Calle QA 456",
};
const setting = async (key: string, value: string) => {
  await Settings.upsert({
    key,
    value,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};
async function makeInvoice() {
  const client = await Client.findOne(),
    user = await User.findOne(),
    garment = await GarmentType.findOne();
  const uniq = Date.now().toString(36) + seq++;
  const order = await Order.create({
    order_number: "AF" + uniq,
    client_id: client!.id,
    created_by: user!.id,
    total_amount: 121,
    status: "pending",
  });
  await OrderItem.create({
    order_id: order.id,
    garment_type_id: garment!.id,
    color: "Rojo",
    sizes: { M: 1 },
    unit_price: 121,
  });
  const inv = await Invoice.create({
    order_id: order.id,
    invoice_number: "AFIP-QA-" + uniq,
    issue_date: new Date(),
    status: "issued",
    total_amount: 121,
  });
  targets.push({ target: "invoice", id: inv.id });
  return inv;
}
async function documents(target: string, id: number) {
  return AfipDocument.findAll({
    where: { target, target_id: id },
    order: [["createdAt", "ASC"]],
  });
}
describe("ARCA - persistencia y contrato SOAP", () => {
  let admin: string;
  const envNames = [
    "AFIP_CERT_BASE64_HOMO",
    "AFIP_KEY_BASE64_HOMO",
    "AFIP_CERT_BASE64_PROD",
    "AFIP_KEY_BASE64_PROD",
  ];
  const savedEnv: Record<string, string | undefined> = {};
  const ticketIds: string[] = [];
  beforeAll(async () => {
    admin = await loginAs("admin");
    for (const [key, value] of Object.entries(testSettings)) {
      const row = await Settings.findByPk(key);
      saved.set(key, row?.value ?? null);
      await setting(key, value);
    }
    for (const k of envNames) savedEnv[k] = process.env[k];
    const pair = forge.pki.rsa.generateKeyPair(1024),
      cert = forge.pki.createCertificate();
    cert.publicKey = pair.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: "commonName", value: "QA" }]);
    cert.setIssuer([{ name: "commonName", value: "QA" }]);
    cert.sign(pair.privateKey);
    const pem = forge.pki.certificateToPem(cert);
    for (const env of ["HOMO", "PROD"]) {
      process.env["AFIP_CERT_BASE64_" + env] =
        Buffer.from(pem).toString("base64");
      process.env["AFIP_KEY_BASE64_" + env] = Buffer.from(
        forge.pki.privateKeyToPem(pair.privateKey),
      ).toString("base64");
      ticketIds.push(
        createHash("sha256")
          .update((env === "HOMO" ? "homo" : "prod") + pem)
          .digest("hex"),
      );
    }
  });
  beforeEach(async () => {
    mockState.calls = 0;
    mockState.failAfter = false;
    mockState.reject = false;
    mockState.invalidLast = false;
    mockState.delay = false;
    mockState.globalError = false;
    await setting("afip_enabled", "true");
    await setting("afip_environment", "homo");
    await setting("company_iva_condition", "Responsable Inscripto");
  });
  afterEach(async () => {
    for (const t of targets) {
      await AfipDocument.destroy({
        where: { target: t.target, target_id: t.id },
      });
      if (t.target === "catalogInvoice")
        await CatalogInvoice.destroy({ where: { id: t.id } });
    }
  });
  afterAll(async () => {
    for (const [key, value] of saved) {
      if (value === null) await Settings.destroy({ where: { key } });
      else await setting(key, value);
    }
    for (const key of envNames) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const id of ticketIds) await AfipAuthTicket.destroy({ where: { id } });
  });
  const send = (id: number, params: any = p) =>
    api()
      .post(API + "/invoices/" + id + "/afip")
      .set(...auth(admin))
      .send(params);
  it("firma/autentica, acepta array SOAP y conserva CAE sin contaminar producción", async () => {
    const inv = await makeInvoice();
    const res = await send(inv.id);
    expect(res.status).toBe(200);
    const [doc] = await documents("invoice", inv.id);
    expect(doc.status).toBe("sent");
    expect(doc.response.authorization.CAE).toBe("71234567890123");
    expect((await inv.reload()).afip_status).toBeNull();
    expect(doc.snapshot.params.receptorNombre).toBe("Receptor QA");
    const ticket = await AfipAuthTicket.findByPk(ticketIds[0]);
    expect(ticket!.encrypted).not.toContain("TEST");
    const again = await send(inv.id);
    expect(again.status).toBe(200);
    expect(mockState.calls).toBe(1);
  });
  it("recupera autorización perdida sin emitir otro número", async () => {
    const inv = await makeInvoice();
    mockState.failAfter = true;
    expect((await send(inv.id)).status).toBe(422);
    const [doc] = await documents("invoice", inv.id);
    expect(doc.status).toBe("uncertain");
    const result = await api()
      .post(API + "/afip/documents/" + doc.id + "/recover")
      .set(...auth(admin));
    expect(result.status).toBe(200);
    expect(mockState.calls).toBe(1);
    expect((await doc.reload()).status).toBe("sent");
  });
  it("serializa solicitudes concurrentes y no agota conexiones esperando", async () => {
    const inv = await makeInvoice();
    mockState.delay = true;
    const res = await Promise.all([send(inv.id), send(inv.id)]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 422]);
    expect(mockState.calls).toBe(1);
  });
  it("no emite otro documento mientras hay un intento sin resolver", async () => {
    const first = await makeInvoice();
    mockState.failAfter = true;
    await send(first.id);
    const second = await makeInvoice();
    const res = await send(second.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/pendiente/);
    expect(mockState.calls).toBe(1);
  });
  it("rechazo explícito guarda observaciones y permite una solicitud corregida", async () => {
    const inv = await makeInvoice();
    mockState.reject = true;
    const res = await send(inv.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/10016/);
    mockState.reject = false;
    expect((await send(inv.id)).status).toBe(200);
    expect(
      (await documents("invoice", inv.id)).map((d) => d.status).sort(),
    ).toEqual(["rejected", "sent"]);
  });
  it("error global no se confunde con rechazo definitivo", async () => {
    const inv = await makeInvoice();
    mockState.globalError = true;
    expect((await send(inv.id)).status).toBe(422);
    expect((await documents("invoice", inv.id))[0].status).toBe("uncertain");
  });
  it("último autorizado inválido no deriva en número uno", async () => {
    const inv = await makeInvoice();
    mockState.invalidLast = true;
    expect((await send(inv.id)).status).toBe(422);
    expect(mockState.calls).toBe(0);
    expect(await documents("invoice", inv.id)).toHaveLength(0);
  });
  it("gate deshabilitado no llama a SOAP ni toca documento", async () => {
    const inv = await makeInvoice();
    await setting("afip_enabled", "false");
    expect((await send(inv.id)).status).toBe(422);
    expect(mockState.calls).toBe(0);
    expect(await documents("invoice", inv.id)).toHaveLength(0);
  });
  it("permisos bloquean vendedor y diseñador", async () => {
    const inv = await makeInvoice();
    for (const role of ["seller", "designer"] as const) {
      const token = await loginAs(role);
      expect(
        (
          await api()
            .post(API + "/invoices/" + inv.id + "/afip")
            .set(...auth(token))
            .send(p)
        ).status,
      ).toBe(403);
    }
  });
  it("homologación no impide emitir después en producción", async () => {
    const inv = await makeInvoice();
    await send(inv.id);
    await setting("afip_environment", "prod");
    expect((await send(inv.id)).status).toBe(200);
    expect(await documents("invoice", inv.id)).toHaveLength(2);
    expect((await inv.reload()).afip_status).toBe("sent");
  });
  it("producción congela importes y exige crédito antes de anular", async () => {
    const inv = await makeInvoice();
    await setting("afip_environment", "prod");
    await send(inv.id);
    const edit = await api()
      .put(API + "/invoices/" + inv.id)
      .set(...auth(admin))
      .send({ discount_amount: 5 });
    expect(edit.status).toBe(409);
    const cancel = await api()
      .put(API + "/invoices/" + inv.id)
      .set(...auth(admin))
      .send({ status: "cancelled" });
    expect(cancel.status).toBe(409);
  });
  it("crédito parcial idempotente, saldo máximo y recuperación", async () => {
    const inv = await makeInvoice();
    await send(inv.id);
    const [doc] = await documents("invoice", inv.id),
      key = randomUUID();
    const credit = (amount: number, k = key) =>
      api()
        .post(API + "/afip/documents/" + doc.id + "/credit")
        .set(...auth(admin))
        .send({ amount, reason: "Devolución parcial", key: k });
    mockState.failAfter = true;
    expect((await credit(21)).status).toBe(422);
    expect((await credit(21)).status).toBe(200);
    expect(mockState.calls).toBe(2);
    expect((await credit(22)).status).toBe(422);
    expect((await credit(101, randomUUID())).status).toBe(422);
    expect((await credit(100, randomUUID())).status).toBe(200);
  });
  it("descarga fiscal y QR usan snapshot incluso si cambian settings", async () => {
    const inv = await makeInvoice();
    await send(inv.id);
    const [doc] = await documents("invoice", inv.id);
    const qr = fiscalQrPayload(doc);
    expect(qr.importe).toBe(121);
    expect(qr.codAut).toBe(71234567890123);
    await setting("company_name", "Nombre cambiado");
    const res = await api()
      .get(API + "/afip/documents/" + doc.id + "/pdf")
      .set(...auth(admin));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
    await setting("company_name", "Emisor QA");
  });
  it("emite B y C sin IVA discriminado en C", async () => {
    const inv = await makeInvoice();
    expect(
      (
        await send(inv.id, {
          ...p,
          tipoComprobante: 6,
          condicionIvaReceptor: 5,
          docTipo: 96,
          docNro: "30123456",
        })
      ).status,
    ).toBe(200);
    await setting("company_iva_condition", "Monotributista");
    const c = await makeInvoice();
    expect(
      (await send(c.id, { ...p, tipoComprobante: 11, ivaAlicuota: 0 })).status,
    ).toBe(200);
    const [doc] = await documents("invoice", c.id);
    expect(doc.snapshot.detail.ImpIVA).toBe(0);
    expect(doc.snapshot.detail.Iva).toBeUndefined();
  });
  it("servicios exige fechas y rechaza combinaciones inválidas", async () => {
    const inv = await makeInvoice();
    expect((await send(inv.id, { ...p, concepto: 2 })).status).toBe(422);
    expect((await send(inv.id, { ...p, tipoComprobante: 11 })).status).toBe(
      422,
    );
    expect(mockState.calls).toBe(0);
  });
  it("cubre catálogo y tienda, con snapshot del origen", async () => {
    const user = await User.findOne(),
      client = await Client.findOne();
    const n = Date.now().toString(36);
    const cat = await CatalogOrder.create({
      order_number: "AC" + n,
      seller_id: user!.id,
      client_id: client!.id,
      total_amount: 121,
      payment_amount: 121,
    });
    const product = await CatalogProduct.findOne();
    await CatalogOrderItem.create({
      catalog_order_id: cat.id,
      product_id: product!.id,
      quantity: 1,
      unit_price: 121,
      subtotal: 121,
    });
    const inv = await CatalogInvoice.create({
      catalog_order_id: cat.id,
      invoice_number: "ACF" + n,
      issue_date: new Date().toISOString().slice(0, 10),
      total_amount: 121,
      status: "paid",
      payment_amount: 121,
    });
    targets.push({ target: "catalogInvoice", id: inv.id });
    expect(
      (
        await api()
          .post(API + "/catalog/invoices/" + inv.id + "/afip")
          .set(...auth(admin))
          .send(p)
      ).status,
    ).toBe(200);
    const order = await StoreOrder.create({
      order_number: "AS" + n,
      customer_name: "Tienda QA",
      customer_email: "qa@test.local",
      customer_dni: "30123456",
      subtotal: 121,
      total_amount: 121,
      status: "paid",
    });
    await StoreOrderItem.create({
      store_order_id: order.id,
      catalog_product_id: product!.id,
      product_title: "Prenda QA",
      quantity: 1,
      unit_price: 121,
      subtotal: 121,
    });
    targets.push({ target: "storeOrder", id: order.id });
    expect(
      (
        await api()
          .post(API + "/store/orders/" + order.id + "/afip")
          .set(...auth(admin))
          .send({
            ...p,
            tipoComprobante: 6,
            docTipo: 96,
            docNro: "30123456",
            condicionIvaReceptor: 5,
          })
      ).status,
    ).toBe(200);
  });
  it("no adopta una autorización con IVA o comprobante asociado distinto", async () => {
    const inv = await makeInvoice();
    mockState.failAfter = true;
    await send(inv.id);
    const [doc] = await documents("invoice", inv.id);
    const remote = mockState.remote.get(
      "homo:1:" + doc.snapshot.detail.CbteDesde,
    );
    remote.Iva = { AlicIva: [{ Id: 4, BaseImp: 100, Importe: 21 }] };
    expect(
      (
        await api()
          .post(API + "/afip/documents/" + doc.id + "/recover")
          .set(...auth(admin))
      ).status,
    ).toBe(422);
    expect(mockState.calls).toBe(1);
    expect((await doc.reload()).status).toBe("uncertain");
  });
  it("recuperación exige ambiente original y no crea otro documento", async () => {
    const inv = await makeInvoice();
    mockState.failAfter = true;
    await send(inv.id);
    const [doc] = await documents("invoice", inv.id);
    await setting("afip_environment", "prod");
    expect(
      (
        await api()
          .post(API + "/afip/documents/" + doc.id + "/recover")
          .set(...auth(admin))
      ).status,
    ).toBe(422);
    expect(await documents("invoice", inv.id)).toHaveLength(1);
    expect(mockState.calls).toBe(1);
  });
  it("conserva pedido fiscal y admite edición administrativa sin alterar importes", async () => {
    const inv = await makeInvoice();
    await setting("afip_environment", "prod");
    await send(inv.id);
    expect(
      (
        await api()
          .delete(API + "/orders/" + inv.order_id)
          .set(...auth(admin))
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .put(API + "/invoices/" + inv.id)
          .set(...auth(admin))
          .send({
            notes: "Seguimiento administrativo",
            discount_amount: 0,
            extra_items: [],
          })
      ).status,
    ).toBe(200);
    expect(Number((await inv.reload()).total_amount)).toBe(121);
    const [doc] = await documents("invoice", inv.id);
    expect(doc.snapshot.actorId).toBeGreaterThan(0);
  });
  it("créditos acumulados cierran neto e IVA y habilitan anulación", async () => {
    const inv = await makeInvoice();
    await setting("afip_environment", "prod");
    await send(inv.id);
    const [doc] = await documents("invoice", inv.id);
    for (const amount of [40.33, 40.33, 40.34])
      expect(
        (
          await api()
            .post(API + "/afip/documents/" + doc.id + "/credit")
            .set(...auth(admin))
            .send({ amount, reason: "Ajuste total", key: randomUUID() })
        ).status,
      ).toBe(200);
    const credits = (await documents("invoice", inv.id)).filter(
      (d) => d.snapshot.kind === "credit",
    );
    expect(
      credits.reduce(
        (sum, d) => sum + Math.round(d.snapshot.detail.ImpNeto * 100),
        0,
      ),
    ).toBe(10000);
    expect(
      credits.reduce(
        (sum, d) => sum + Math.round(d.snapshot.detail.ImpIVA * 100),
        0,
      ),
    ).toBe(2100);
    expect(
      (
        await api()
          .put(API + "/invoices/" + inv.id)
          .set(...auth(admin))
          .send({ status: "cancelled" })
      ).status,
    ).toBe(200);
  });
  it("emite servicios con fechas y exento sin array IVA", async () => {
    const inv = await makeInvoice();
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date());
    expect(
      (
        await send(inv.id, {
          ...p,
          concepto: 2,
          fechaServicioDesde: date,
          fechaServicioHasta: date,
          fechaVencimientoPago: date,
          ivaAlicuota: 0,
          ivaTratamiento: "exento",
        })
      ).status,
    ).toBe(200);
    const [doc] = await documents("invoice", inv.id);
    expect(doc.snapshot.detail.ImpOpEx).toBe(121);
    expect(doc.snapshot.detail.Iva).toBeUndefined();
  });
  it("intento legado sin snapshot exige conciliación antes de emitir", async () => {
    const inv = await makeInvoice();
    await inv.update({ afip_status: "pending" });
    await setting("afip_environment", "prod");
    expect((await send(inv.id)).status).toBe(422);
    expect(mockState.calls).toBe(0);
  });
  it("libera lock ante excepción", async () => {
    await expect(
      withAfipLock("qa-lock", async () => {
        throw new Error("QA");
      }),
    ).rejects.toThrow("QA");
    expect(await withAfipLock("qa-lock", async () => true)).toBe(true);
  });
  it("TRA conserva UTC y comparación no acepta otro importe/receptor", () => {
    const now = new Date("2026-09-10T01:00:00Z"),
      xml = buildTraXml(now);
    expect(xml).toContain(
      "<generationTime>2026-09-10T00:50:00.000Z</generationTime>",
    );
    const d = buildDetail({ ...p, totalAmount: 121 }, 1);
    expect(matches(d, { ...d, CbteTipo: 1, PtoVta: 9998 }, 1, 9998)).toBe(true);
    expect(
      matches(
        d,
        { ...d, DocNro: "30123456", CbteTipo: 1, PtoVta: 9998 },
        1,
        9998,
      ),
    ).toBe(false);
    expect(() =>
      validateParams({ ...p, totalAmount: 121, ivaAlicuota: 27 }, testSettings),
    ).toThrow();
  });
});
