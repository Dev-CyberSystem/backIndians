import { randomUUID } from "crypto";
import { Op } from "sequelize";
import { sequelize } from "../config/db";
import {
  Invoice,
  CatalogInvoice,
  StoreOrder,
  Order,
  Client,
  OrderItem,
  GarmentType,
  CatalogOrder,
  CatalogOrderItem,
  CatalogProduct,
  StoreOrderItem,
  StoreReturn,
} from "../models";
import { AfipDocument, AfipTarget } from "../models/AfipDocument";
import { getAllSettings } from "./settings.service";
import { assertAfipEnabled, withAfipLock, wsfe } from "./afip.transport";
import {
  AfipSendParams,
  accepted,
  buildDetail,
  digits,
  errors,
  issuerKind,
  list,
  matches,
  messages,
  validCuit,
  validateParams,
} from "./afip.protocol";
import { businessDate } from "../utils/helpers";
export type { AfipSendParams } from "./afip.protocol";
export { assertAfipEnabled } from "./afip.transport";

export const AFIP_TIPO_COMPROBANTE = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
} as const;
export const AFIP_TIPO_LABELS: Record<number, string> = {
  1: "Factura A",
  6: "Factura B",
  11: "Factura C",
  3: "Nota de crédito A",
  8: "Nota de crédito B",
  13: "Nota de crédito C",
};
export const AFIP_CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;
export const AFIP_CONCEPTO_LABELS = {
  1: "Productos",
  2: "Servicios",
  3: "Productos y Servicios",
};
export const AFIP_DOC_TIPO = { CUIT: 80, DNI: 96, NO_INDICA: 99 } as const;
export const AFIP_CONDICION_IVA = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTISTA: 6,
} as const;
export const AFIP_CONDICION_IVA_LABELS: Record<number, string> = {
  1: "Responsable Inscripto",
  4: "Exento",
  5: "Consumidor Final",
  6: "Monotributista",
};

const models = {
  invoice: Invoice,
  catalogInvoice: CatalogInvoice,
  storeOrder: StoreOrder,
};
function model(target: AfipTarget): any {
  if (!models[target]) throw new Error("Origen fiscal inválido");
  return models[target];
}
async function config() {
  const settings = await getAllSettings();
  const environment = settings.afip_environment;
  if (environment !== "homo" && environment !== "prod")
    throw new Error("Ambiente ARCA inválido");
  const cuit = digits(settings.company_cuit || "");
  const pv = Number(settings.afip_punto_venta);
  if (!validCuit(cuit)) throw new Error("CUIT del emisor inválido");
  if (!Number.isInteger(pv) || pv < 1 || pv > 99999)
    throw new Error("Punto de venta inválido");
  for (const key of [
    "company_name",
    "company_address",
    "company_iva_condition",
    "company_activity_start",
    "company_iibb",
  ]) {
    if (!settings[key]?.trim())
      throw new Error("Completar dato fiscal del emisor: " + key);
  }
  issuerKind(settings);
  return {
    settings,
    environment: environment as "homo" | "prod",
    cuit,
    pv,
    stream: environment + ":" + cuit,
  };
}
async function sourceSnapshot(target: AfipTarget, row: any, transaction: any) {
  if (target === "storeOrder") {
    const items = await StoreOrderItem.findAll({
      where: { store_order_id: row.id },
      transaction,
    });
    return {
      reference: row.order_number,
      receiverName: row.customer_name,
      docTipo: 96,
      docNro: row.customer_dni || "",
      condition: 5,
      receiverAddress: row.shipping_address
        ? [
            row.shipping_address.street,
            row.shipping_address.city,
            row.shipping_address.state,
            row.shipping_address.zip_code,
          ]
            .filter(Boolean)
            .join(", ")
        : "",
      items: items.map((i) => ({
        description: i.product_title + (i.size_name ? " - " + i.size_name : ""),
        quantity: Number(i.quantity),
        unitPrice: Number(i.unit_price),
        total: Number(i.subtotal),
      })),
      extras: Number(row.shipping_cost)
        ? [{ description: "Envío", amount: Number(row.shipping_cost) }]
        : [],
      discount: Number(row.discount_amount || 0),
    };
  }
  const catalog = target === "catalogInvoice";
  const order: any = catalog
    ? await CatalogOrder.findByPk(row.catalog_order_id, {
        include: [
          { model: Client, as: "client" },
          {
            model: CatalogOrderItem,
            as: "items",
            include: [{ model: CatalogProduct, as: "product" }],
          },
        ],
        transaction,
      })
    : await Order.findByPk(row.order_id, {
        include: [
          { model: Client, as: "client" },
          {
            model: OrderItem,
            as: "items",
            include: [{ model: GarmentType, as: "garmentType" }],
          },
        ],
        transaction,
      });
  if (!order) throw new Error("Pedido de origen inexistente");
  return {
    reference: row.invoice_number,
    receiverName: order.client?.name || "",
    receiverAddress: order.client?.address || "",
    docTipo: 80,
    docNro: order.client?.cuit || "",
    condition: order.client?.condicion_iva || 5,
    items: (order.items || []).map((i: any) => {
      const quantity = catalog
        ? Number(i.quantity)
        : Object.values(i.sizes || {}).reduce(
            (a: number, b: any) => a + Number(b),
            0,
          );
      return {
        description: catalog
          ? (i.product?.name ||
              i.product?.title ||
              "Producto " + i.product_id) +
            (i.size_name ? " - " + i.size_name : "")
          : i.garmentType?.name || "Prenda",
        quantity,
        unitPrice: Number(i.unit_price || 0),
        total: Math.round(quantity * Number(i.unit_price || 0) * 100) / 100,
      };
    }),
    extras: catalog ? [] : row.extra_items || [],
    discount: Number(row.discount_amount || 0),
  };
}
async function mirror(doc: AfipDocument) {
  if (doc.environment !== "prod" || doc.snapshot.kind === "credit") return;
  const s = doc.snapshot;
  const det = doc.response?.authorization;
  await model(doc.target).update(
    {
      afip_status:
        doc.status === "sent"
          ? "sent"
          : doc.status === "rejected"
            ? "error"
            : "pending",
      afip_error: doc.error,
      ...(doc.status === "sent"
        ? {
            afip_tipo_comprobante: s.type,
            afip_concepto: s.detail.Concepto,
            afip_iva_alicuota: s.params.ivaAlicuota,
            afip_doc_tipo: s.detail.DocTipo,
            afip_condicion_iva_receptor: s.detail.CondicionIVAReceptorId,
            afip_punto_venta: s.pv,
            afip_cbte_nro: s.detail.CbteDesde,
            afip_cae: det.CAE,
            afip_cae_vto: String(det.CAEFchVto).replace(
              /(\d{4})(\d{2})(\d{2})/,
              "$1-$2-$3",
            ),
            afip_sent_at: doc.updatedAt,
          }
        : {}),
    },
    { where: { id: doc.target_id } },
  );
}
/** Conserva el resultado antes de actualizar la proyección administrativa. */
async function persistAccepted(
  doc: AfipDocument,
  authorization: any,
  raw: any,
) {
  await doc.update({
    status: "sent",
    error: null,
    response: { authorization, raw },
  });
  await mirror(doc);
  return doc;
}
async function transmit(
  doc: AfipDocument,
  client: Awaited<ReturnType<typeof wsfe>>,
) {
  const s = doc.snapshot;
  // Siempre consultar primero: incluye caída entre persistir intento y enviar.
  const consultation = await client.call("FECompConsultar", {
    FeCompConsReq: {
      CbteTipo: s.type,
      PtoVta: s.pv,
      CbteNro: s.detail.CbteDesde,
    },
  });
  const found = consultation?.ResultGet;
  if (found) {
    errors(consultation);
    if (
      found.Resultado !== "A" ||
      !matches(s.detail, found, s.type, s.pv) ||
      (found.EmisionTipo && found.EmisionTipo !== "CAE")
    ) {
      throw new Error(
        "El número reservado existe en ARCA con datos distintos. Requiere conciliación manual; no se emitió otro número",
      );
    }
    const auth = {
      ...found,
      CAE: found.CodAutorizacion,
      CAEFchVto: found.FchVto,
    };
    accepted({ FeDetResp: { FECAEDetResponse: [auth] } });
    return persistAccepted(doc, auth, consultation);
  }
  const errs = list<any>(consultation?.Errors?.Err);
  // 602 = comprobante inexistente. Una respuesta vacía o de otro error NO habilita emisión.
  if (errs.length !== 1 || Number(errs[0].Code) !== 602) {
    errors(consultation);
    throw new Error("Consulta ARCA inconclusa. No se emitió el comprobante");
  }
  const last = await client.call("FECompUltimoAutorizado", {
    PtoVta: s.pv,
    CbteTipo: s.type,
  });
  errors(last);
  if (
    !Number.isInteger(Number(last?.CbteNro)) ||
    Number(last.CbteNro) !== s.detail.CbteDesde - 1
  )
    throw new Error(
      "Numeración ARCA cambió; conciliar el intento antes de continuar",
    );
  await doc.update({ status: "uncertain", error: null });
  await mirror(doc);
  const raw = await client.call("FECAESolicitar", {
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: s.pv, CbteTipo: s.type },
      FeDetReq: { FECAEDetRequest: [s.detail] },
    },
  });
  try {
    const det = accepted(raw);
    if (
      Number(det.CbteDesde) !== s.detail.CbteDesde ||
      Number(det.CbteHasta) !== s.detail.CbteHasta
    )
      throw new Error("ARCA devolvió un número distinto al solicitado");
    return persistAccepted(doc, det, raw);
  } catch (err: any) {
    // Solo rechazo fiscal explícito permite preparar una nueva solicitud.
    if (err.fiscalRejected) {
      await doc.update({
        status: "rejected",
        error: err.message,
        response: raw,
      });
      await mirror(doc);
    }
    throw err;
  }
}
async function emit(
  target: AfipTarget,
  targetId: number,
  input: AfipSendParams,
  credit?: { originalId: string; amount: number; reason: string; key: string },
  actorId?: number,
) {
  await assertAfipEnabled();
  const cfg = await config();
  return withAfipLock(
    "target:" + target + ":" + targetId + ":" + cfg.environment,
    () =>
      withAfipLock("emitter:" + cfg.stream, async () => {
        const existing = credit
          ? await AfipDocument.findByPk("credit:" + credit.key)
          : await AfipDocument.findOne({
              where: {
                target,
                target_id: targetId,
                environment: cfg.environment,
                status: { [Op.ne]: "rejected" },
                "snapshot.kind": "invoice",
              },
              order: [["createdAt", "ASC"]],
            });
        let doc =
          existing && existing.snapshot.kind !== "credit"
            ? existing
            : credit
              ? existing
              : null;
        if (doc) {
          if (
            doc.target !== target ||
            doc.target_id !== targetId ||
            doc.environment !== cfg.environment ||
            (credit && doc.snapshot.originalId !== credit.originalId)
          )
            throw new Error("La clave de reintento pertenece a otra operación");
          if (
            credit &&
            (Number(doc.snapshot.detail.ImpTotal) !== credit.amount ||
              doc.snapshot.reason !== credit.reason)
          )
            throw new Error(
              "La clave de reintento tiene otro importe o motivo",
            );
          if (doc.status === "sent") {
            await mirror(doc);
            return doc;
          }
          if (doc.status === "rejected")
            throw new Error(
              "Nota rechazada: iniciar una nueva solicitud con otra clave",
            );
          if (doc.stream !== cfg.stream || doc.snapshot.pv !== cfg.pv)
            throw new Error(
              "Existe un intento pendiente con otra configuración fiscal. Restaurarla para conciliar",
            );
        }
        const pending = await AfipDocument.findOne({
          where: {
            stream: cfg.stream,
            status: { [Op.in]: ["prepared", "uncertain"] },
            ...(doc ? { id: { [Op.ne]: doc.id } } : {}),
          },
        });
        if (pending)
          throw new Error(
            "Primero recuperar el comprobante pendiente: " +
              pending.target +
              " #" +
              pending.target_id,
          );
        const client = await wsfe(cfg.environment, cfg.cuit);
        if (!doc) {
          const original = credit
            ? await AfipDocument.findByPk(credit.originalId)
            : null;
          let params = { ...input };
          let type = params.tipoComprobante;
          let priorCredits: AfipDocument[] = [];
          if (credit) {
            if (
              !original ||
              original.status !== "sent" ||
              original.snapshot.kind !== "invoice" ||
              original.target !== target ||
              original.target_id !== targetId ||
              original.environment !== cfg.environment ||
              original.stream !== cfg.stream
            )
              throw new Error(
                "Factura original inválida para la nota de crédito",
              );
            const all = await AfipDocument.findAll({
              where: {
                target,
                target_id: targetId,
                environment: cfg.environment,
                status: { [Op.ne]: "rejected" },
              },
            });
            priorCredits = all.filter(
              (d) => d.snapshot.originalId === original.id,
            );
            const credited = priorCredits.reduce(
              (sum, d) =>
                sum + Math.round(Number(d.snapshot.detail.ImpTotal) * 100),
              0,
            );
            const amount = Math.round(credit.amount * 100);
            if (
              !Number.isFinite(credit.amount) ||
              credit.amount <= 0 ||
              Math.abs(amount - credit.amount * 100) > 0.0001 ||
              amount + credited >
                Math.round(original.snapshot.detail.ImpTotal * 100)
            )
              throw new Error(
                "El crédito supera el saldo fiscal disponible o tiene un importe inválido",
              );
            if (!credit.reason?.trim() || credit.reason.length > 500)
              throw new Error(
                "Indicar motivo de la nota de crédito (hasta 500 caracteres)",
              );
            params = {
              ...original.snapshot.params,
              totalAmount: credit.amount,
              fechaVencimientoPago: businessDate(),
            };
            type = ({ 1: 3, 6: 8, 11: 13 } as Record<number, number>)[
              original.snapshot.type
            ];
          }
          // Validaciones del contrato publicadas por ARCA, además de las locales.
          const types = await client.call("FEParamGetTiposCbte", {});
          errors(types);
          if (
            !list<any>(types?.ResultGet?.CbteTipo).some(
              (x) => Number(x.Id) === type,
            )
          )
            throw new Error("Tipo de comprobante no habilitado en ARCA");
          const points = await client.call("FEParamGetPtosVenta", {});
          errors(points);
          if (
            !list<any>(points?.ResultGet?.PtoVenta).some(
              (x) =>
                Number(x.Nro) === cfg.pv &&
                x.Bloqueado !== "S" &&
                (!x.FchBaja || x.FchBaja === "NULL"),
            )
          )
            throw new Error("Punto de venta no habilitado para Web Services");
          const conditions = await client.call(
            "FEParamGetCondicionIvaReceptor",
            {
              ClaseCmp: [1, 3].includes(type)
                ? "A"
                : [6, 8].includes(type)
                  ? "B"
                  : "C",
            },
          );
          errors(conditions);
          if (
            !list<any>(conditions?.ResultGet?.CondicionIvaReceptor).some(
              (x) => Number(x.Id) === params.condicionIvaReceptor,
            )
          )
            throw new Error(
              "Condición IVA no admitida por ARCA para este comprobante",
            );
          const last = await client.call("FECompUltimoAutorizado", {
            PtoVta: cfg.pv,
            CbteTipo: type,
          });
          errors(last);
          if (
            !Number.isInteger(Number(last?.CbteNro)) ||
            Number(last.CbteNro) < 0
          )
            throw new Error("Último autorizado ARCA inválido");
          const number = Number(last.CbteNro) + 1;
          doc = await sequelize.transaction(async (transaction) => {
            const row = await model(target).findByPk(targetId, {
              transaction,
              lock: transaction.LOCK.UPDATE,
            });
            if (!row) throw new Error("Documento de origen no encontrado");
            if (!credit && ["cancelled", "returned"].includes(row.status))
              throw new Error(
                "No se puede facturar un documento cancelado/devuelto",
              );
            if (
              !credit &&
              target === "storeOrder" &&
              row.status === "pending_payment"
            )
              throw new Error(
                "Confirmar el pago de la tienda antes de facturar",
              );
            if (
              !credit &&
              cfg.environment === "prod" &&
              row.afip_status &&
              !(await AfipDocument.count({
                where: { target, target_id: targetId, environment: "prod" },
                transaction,
              }))
            )
              throw new Error(
                "Intento fiscal anterior sin snapshot: requiere conciliación antes de volver a emitir",
              );
            const source = credit
              ? original!.snapshot.source
              : await sourceSnapshot(target, row, transaction);
            if (!credit) {
              params.totalAmount = Number(row.total_amount);
              params.receptorNombre =
                params.receptorNombre?.trim() || source.receiverName;
              params.receptorDomicilio =
                params.receptorDomicilio?.trim() || source.receiverAddress;
              validateParams(params, cfg.settings);
              const calculated =
                source.items.reduce(
                  (sum: number, item: any) =>
                    sum + Math.round(item.total * 100),
                  0,
                ) +
                source.extras.reduce(
                  (sum: number, item: any) =>
                    sum + Math.round(item.amount * 100),
                  0,
                ) -
                Math.round(source.discount * 100);
              if (calculated !== Math.round(params.totalAmount * 100))
                throw new Error(
                  "El detalle del pedido no coincide con el total. Revisar cantidades, extras y descuentos antes de facturar",
                );
            }
            const detail = buildDetail(
              { ...params, tipoComprobante: type },
              number,
            );
            if (credit && detail.Iva) {
              // Distribución acumulada en centavos: la última NC cierra exactamente neto e IVA.
              const originalDetail = original!.snapshot.detail;
              const priorTotal = priorCredits.reduce(
                (sum, d) => sum + Math.round(d.snapshot.detail.ImpTotal * 100),
                0,
              );
              const priorNet = priorCredits.reduce(
                (sum, d) => sum + Math.round(d.snapshot.detail.ImpNeto * 100),
                0,
              );
              const cumulative = priorTotal + Math.round(detail.ImpTotal * 100);
              const netCents =
                Math.round(
                  (Math.round(originalDetail.ImpNeto * 100) * cumulative) /
                    Math.round(originalDetail.ImpTotal * 100),
                ) - priorNet;
              detail.ImpNeto = netCents / 100;
              detail.ImpIVA =
                (Math.round(detail.ImpTotal * 100) - netCents) / 100;
              detail.Iva.AlicIva[0].BaseImp = detail.ImpNeto;
              detail.Iva.AlicIva[0].Importe = detail.ImpIVA;
            }
            if (credit)
              detail.CbtesAsoc = {
                CbteAsoc: [
                  {
                    Tipo: original!.snapshot.type,
                    PtoVta: original!.snapshot.pv,
                    Nro: original!.snapshot.detail.CbteDesde,
                    Cuit: cfg.cuit,
                    CbteFch: original!.snapshot.detail.CbteFch,
                  },
                ],
              };
            const issuer = Object.fromEntries(
              [
                "company_name",
                "company_address",
                "company_iva_condition",
                "company_iibb",
                "company_activity_start",
              ].map((k) => [k, cfg.settings[k]]),
            );
            const document = await AfipDocument.create(
              {
                id: credit ? "credit:" + credit.key : randomUUID(),
                target,
                target_id: targetId,
                environment: cfg.environment,
                stream: cfg.stream,
                status: "prepared",
                snapshot: {
                  version: 1,
                  kind: credit ? "credit" : "invoice",
                  originalId: credit?.originalId,
                  reason: credit?.reason,
                  cuit: cfg.cuit,
                  pv: cfg.pv,
                  type,
                  params,
                  detail,
                  issuer,
                  source,
                  actorId: actorId ?? null,
                  preparedAt: new Date().toISOString(),
                },
                response: null,
                error: null,
              },
              { transaction },
            );
            if (!credit && cfg.environment === "prod")
              await row.update(
                { afip_status: "pending", afip_error: null },
                { transaction },
              );
            return document;
          });
        }
        try {
          return await transmit(doc, client);
        } catch (err: any) {
          if (doc.status !== "rejected" && doc.status !== "sent")
            await doc.update({ error: String(err.message).slice(0, 2000) });
          await mirror(doc);
          throw err;
        }
      }),
  );
}
export async function sendInvoiceToAfip(
  id: number,
  p: AfipSendParams,
  actorId?: number,
): Promise<Invoice> {
  await emit("invoice", id, p, undefined, actorId);
  return (await Invoice.findByPk(id))!;
}
export async function sendCatalogInvoiceToAfip(
  id: number,
  p: AfipSendParams,
  actorId?: number,
): Promise<CatalogInvoice> {
  await emit("catalogInvoice", id, p, undefined, actorId);
  return (await CatalogInvoice.findByPk(id))!;
}
export async function sendStoreOrderToAfip(
  id: number,
  p: AfipSendParams,
  actorId?: number,
): Promise<StoreOrder> {
  await emit("storeOrder", id, p, undefined, actorId);
  return (await StoreOrder.findByPk(id))!;
}
export async function issueCredit(
  id: string,
  amount: number,
  reason: string,
  key: string,
  actorId?: number,
) {
  const original = await AfipDocument.findByPk(id);
  if (!original) throw new Error("Factura fiscal no encontrada");
  return emit(
    original.target,
    original.target_id,
    original.snapshot.params,
    { originalId: id, amount, reason, key },
    actorId,
  );
}
export async function getDocuments(target: AfipTarget, id: number) {
  model(target);
  return AfipDocument.findAll({
    where: { target, target_id: id },
    order: [["createdAt", "DESC"]],
  });
}
export async function recoverDocument(id: string) {
  const doc = await AfipDocument.findByPk(id);
  if (!doc) throw new Error("Comprobante no encontrado");
  if ((await getAllSettings()).afip_environment !== doc.environment)
    throw new Error(
      "Seleccionar el ambiente original del comprobante para recuperarlo",
    );
  const s = doc.snapshot;
  return emit(
    doc.target,
    doc.target_id,
    s.params,
    s.kind === "credit"
      ? {
          originalId: s.originalId,
          amount: Number(s.detail.ImpTotal),
          reason: s.reason,
          key: doc.id.replace(/^credit:/, ""),
        }
      : undefined,
  );
}
export async function getAfipConfig() {
  const s = await getAllSettings();
  let kind: string | null = null;
  try {
    kind = issuerKind(s);
  } catch {
    /* configuración incompleta visible */
  }
  return {
    enabled: s.afip_enabled === "true",
    environment: s.afip_environment || "homo",
    puntoVenta: s.afip_punto_venta,
    issuerKind: kind,
    concepto: Number(s.afip_concepto_default) || 1,
  };
}
export async function getFiscalContext(target: AfipTarget, id: number) {
  const row = await model(target).findByPk(id);
  if (!row) throw new Error("Documento no encontrado");
  const s = await sourceSnapshot(target, row, undefined);
  return {
    name: s.receiverName,
    address: s.receiverAddress,
    docTipo: s.docTipo,
    docNro: s.docNro,
    condition: s.condition,
    total: Number(row.total_amount),
  };
}
export async function getFiscalAttention() {
  const docs = await AfipDocument.findAll({
    where: { status: { [Op.in]: ["prepared", "uncertain", "sent"] } },
  });
  const attention: Array<{
    id: string;
    target: AfipTarget;
    targetId: number;
    reference: string;
    environment: string;
    message: string;
    amount: number;
  }> = [];
  const originals = docs.filter(
    (d) =>
      d.environment === "prod" &&
      d.status === "sent" &&
      d.snapshot.kind === "invoice",
  );
  const rows = new Map<string, any>();
  for (const target of [
    "invoice",
    "catalogInvoice",
    "storeOrder",
  ] as AfipTarget[]) {
    const ids = originals
      .filter((d) => d.target === target)
      .map((d) => d.target_id);
    if (ids.length)
      for (const row of await model(target).findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ["id", "status"],
      }))
        rows.set(target + ":" + row.id, row);
  }
  const refunds = new Map<number, number>();
  const storeIds = originals
    .filter((d) => d.target === "storeOrder")
    .map((d) => d.target_id);
  if (storeIds.length) {
    const returns = await StoreReturn.findAll({
      where: {
        store_order_id: { [Op.in]: storeIds },
        refund_status: "refunded",
      },
      attributes: ["store_order_id", "refunded_amount"],
    });
    for (const r of returns)
      refunds.set(
        r.store_order_id,
        (refunds.get(r.store_order_id) || 0) + Number(r.refunded_amount || 0),
      );
  }
  const credits = new Map<string, number>();
  for (const d of docs)
    if (d.status === "sent" && d.snapshot.originalId)
      credits.set(
        d.snapshot.originalId,
        (credits.get(d.snapshot.originalId) || 0) +
          Number(d.snapshot.detail.ImpTotal),
      );
  for (const doc of docs) {
    const s = doc.snapshot;
    if (doc.status !== "sent") {
      attention.push({
        id: doc.id,
        target: doc.target,
        targetId: doc.target_id,
        reference: s.source.reference,
        environment: doc.environment,
        message: doc.error || "Emisión pendiente de confirmar",
        amount: Number(s.detail.ImpTotal),
      });
    } else if (doc.environment === "prod" && s.kind === "invoice") {
      const row = rows.get(doc.target + ":" + doc.target_id);
      const refunded =
        doc.target === "storeOrder" ? refunds.get(doc.target_id) || 0 : 0;
      const expected =
        row?.status === "cancelled" ? Number(s.detail.ImpTotal) : refunded;
      const credited = credits.get(doc.id) || 0;
      const remaining = Math.round((expected - credited) * 100) / 100;
      if (remaining > 0)
        attention.push({
          id: doc.id,
          target: doc.target,
          targetId: doc.target_id,
          reference: s.source.reference,
          environment: doc.environment,
          message: "Reintegro/anulación con nota de crédito fiscal pendiente",
          amount: remaining,
        });
    }
  }
  return attention;
}
export interface AfipStats {
  invoices: { count: number; total: number };
  catalogInvoices: { count: number; total: number };
  storeOrders: { count: number; total: number };
  byTipo: Record<number, { count: number; total: number }>;
  grandTotal: number;
  grandCount: number;
}
export async function getAfipStats(): Promise<AfipStats> {
  const stats: AfipStats = {
    invoices: { count: 0, total: 0 },
    catalogInvoices: { count: 0, total: 0 },
    storeOrders: { count: 0, total: 0 },
    byTipo: {},
    grandTotal: 0,
    grandCount: 0,
  };
  const docs = await AfipDocument.findAll({
    where: { environment: "prod", status: "sent" },
  });
  for (const d of docs) {
    const amount =
      Number(d.snapshot.detail.ImpTotal) *
      (d.snapshot.kind === "credit" ? -1 : 1);
    const group =
      d.target === "invoice"
        ? stats.invoices
        : d.target === "catalogInvoice"
          ? stats.catalogInvoices
          : stats.storeOrders;
    group.count++;
    group.total += amount;
    stats.grandCount++;
    stats.grandTotal += amount;
    const bucket = (stats.byTipo[d.snapshot.type] ||= { count: 0, total: 0 });
    bucket.count++;
    bucket.total += amount;
  }
  return stats;
}
