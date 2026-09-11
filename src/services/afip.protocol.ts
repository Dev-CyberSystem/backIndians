import { businessDate } from "../utils/helpers";

export interface AfipSendParams {
  tipoComprobante: number;
  concepto: number;
  ivaAlicuota: number;
  docTipo: number;
  docNro: string;
  condicionIvaReceptor: number;
  totalAmount: number;
  receptorNombre?: string;
  receptorDomicilio?: string;
  fechaServicioDesde?: string;
  fechaServicioHasta?: string;
  fechaVencimientoPago?: string;
  ivaTratamiento?: "gravado" | "exento";
}
export const list = <T>(value: T | T[] | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
export const digits = (v: string) => String(v).replace(/[-.\s]/g, "");
export function validCuit(value: string): boolean {
  const n = digits(value);
  if (!/^\d{11}$/.test(n)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const d = 11 - (weights.reduce((s, w, i) => s + w * Number(n[i]), 0) % 11);
  return (d === 11 ? 0 : d === 10 ? 9 : d) === Number(n[10]);
}
export function buildTraXml(now = new Date()): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>' +
    "<uniqueId>" +
    Math.floor(now.getTime() / 1000) +
    "</uniqueId>" +
    "<generationTime>" +
    new Date(now.getTime() - 600000).toISOString() +
    "</generationTime>" +
    "<expirationTime>" +
    new Date(now.getTime() + 3600000).toISOString() +
    "</expirationTime>" +
    "</header><service>wsfe</service></loginTicketRequest>"
  );
}
export function issuerKind(settings: Record<string, string>): "RI" | "C" {
  const condition = (settings.company_iva_condition || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (condition === "responsable inscripto") return "RI";
  if (
    [
      "monotributista",
      "responsable monotributo",
      "monotributo",
      "exento",
      "iva exento",
    ].includes(condition)
  )
    return "C";
  throw new Error(
    "Configurar condición IVA del emisor: Responsable Inscripto, Monotributista o Exento",
  );
}
export function validateParams(
  p: AfipSendParams,
  settings: Record<string, string>,
): void {
  if (![1, 6, 11].includes(p.tipoComprobante))
    throw new Error("Tipo de factura no soportado");
  if (![1, 2, 3].includes(p.concepto)) throw new Error("Concepto inválido");
  if (![0, 10.5, 21].includes(p.ivaAlicuota))
    throw new Error("Alícuota no soportada");
  if (
    !Number.isFinite(p.totalAmount) ||
    p.totalAmount <= 0 ||
    p.totalAmount > 99999999999.99
  )
    throw new Error(
      "El total fiscal debe ser positivo y estar dentro del límite soportado",
    );
  if (Math.abs(p.totalAmount * 100 - Math.round(p.totalAmount * 100)) > 0.0001)
    throw new Error("El total fiscal debe tener como máximo dos decimales");
  if (![80, 96].includes(p.docTipo))
    throw new Error("Identificar al receptor con CUIT o DNI");
  if (p.docTipo === 80 && !validCuit(p.docNro))
    throw new Error("CUIT del receptor inválido");
  if (p.docTipo === 96 && !/^\d{7,9}$/.test(digits(p.docNro)))
    throw new Error("DNI del receptor inválido");
  if (![1, 4, 5, 6].includes(p.condicionIvaReceptor))
    throw new Error("Condición IVA no soportada");
  if (!p.receptorNombre?.trim() || !p.receptorDomicilio?.trim())
    throw new Error(
      "Completar nombre/razón social y domicilio fiscal del receptor",
    );
  if (p.receptorNombre.length > 200 || p.receptorDomicilio.length > 500)
    throw new Error("Datos del receptor demasiado extensos");
  const kind = issuerKind(settings);
  if ((kind === "C") !== (p.tipoComprobante === 11))
    throw new Error(
      "El tipo de factura no corresponde a la condición IVA del emisor",
    );
  if (
    p.tipoComprobante === 1 &&
    (p.docTipo !== 80 || ![1, 6].includes(p.condicionIvaReceptor))
  )
    throw new Error(
      "Factura A requiere CUIT y receptor Responsable Inscripto o Monotributista",
    );
  if (p.tipoComprobante === 6 && ![4, 5].includes(p.condicionIvaReceptor))
    throw new Error("Factura B requiere receptor Exento o Consumidor Final");
  if (p.tipoComprobante === 11 && p.ivaAlicuota !== 0)
    throw new Error("Factura C no discrimina IVA: seleccionar 0%");
  if (p.ivaTratamiento && !["gravado", "exento"].includes(p.ivaTratamiento))
    throw new Error("Tratamiento IVA inválido");
  if (p.ivaTratamiento === "exento" && p.ivaAlicuota !== 0)
    throw new Error("Operación exenta requiere alícuota 0%");
  if (p.concepto !== 1) {
    const dates = [
      p.fechaServicioDesde,
      p.fechaServicioHasta,
      p.fechaVencimientoPago,
    ];
    if (
      dates.some(
        (d) =>
          !d ||
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          isNaN(Date.parse(d)) ||
          new Date(d).toISOString().slice(0, 10) !== d,
      )
    )
      throw new Error(
        "Servicios requieren fechas válidas de inicio, fin y vencimiento de pago",
      );
    if (
      p.fechaServicioDesde! > p.fechaServicioHasta! ||
      p.fechaVencimientoPago! < businessDate()
    )
      throw new Error("Rango de servicio o vencimiento inválido");
  }
}
export function buildDetail(
  p: AfipSendParams,
  number: number,
  date = businessDate(),
): any {
  const total = Math.round(p.totalAmount * 100) / 100;
  const isC = [11, 13].includes(p.tipoComprobante);
  const exempt = !isC && p.ivaTratamiento === "exento";
  const net = isC
    ? total
    : exempt
      ? 0
      : Math.round((total / (1 + p.ivaAlicuota / 100)) * 100) / 100;
  const vat = isC || exempt ? 0 : Math.round((total - net) * 100) / 100;
  return {
    Concepto: p.concepto,
    DocTipo: p.docTipo,
    DocNro: digits(p.docNro),
    CbteDesde: number,
    CbteHasta: number,
    CbteFch: date.replace(/-/g, ""),
    ImpTotal: total,
    ImpTotConc: 0,
    ImpNeto: net,
    ImpOpEx: exempt ? total : 0,
    ImpIVA: vat,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: p.condicionIvaReceptor,
    ...(!isC && !exempt
      ? {
          Iva: {
            AlicIva: [
              {
                Id: ({ 0: 3, 10.5: 4, 21: 5 } as Record<number, number>)[
                  p.ivaAlicuota
                ],
                BaseImp: net,
                Importe: vat,
              },
            ],
          },
        }
      : {}),
    ...(p.concepto !== 1
      ? {
          FchServDesde: p.fechaServicioDesde!.replace(/-/g, ""),
          FchServHasta: p.fechaServicioHasta!.replace(/-/g, ""),
          FchVtoPago: p.fechaVencimientoPago!.replace(/-/g, ""),
        }
      : {}),
  };
}
export function messages(value: any): string {
  return list<any>(value)
    .map((x) => String(x.Code) + ": " + String(x.Msg))
    .join("; ");
}
export function errors(result: any): void {
  const msg = messages(result?.Errors?.Err);
  if (msg) throw new Error("ARCA: " + msg);
}
export function accepted(result: any): any {
  errors(result);
  const all = list<any>(result?.FeDetResp?.FECAEDetResponse);
  if (all.length !== 1)
    throw new Error("Respuesta ARCA incompleta o con cantidad inesperada");
  const det = all[0];
  if (det.Resultado !== "A") {
    const err = new Error(
      "ARCA rechazó el comprobante: " +
        (messages(det.Observaciones?.Obs) || "sin detalle"),
    );
    (err as any).fiscalRejected = det.Resultado === "R";
    throw err;
  }
  if (
    !/^\d{14}$/.test(String(det.CAE)) ||
    !/^\d{8}$/.test(String(det.CAEFchVto))
  )
    throw new Error("ARCA no devolvió CAE/vencimiento válido");
  return det;
}
/** Una consulta nunca se toma como propia solo porque coincide el número. */
export function matches(
  detail: any,
  remote: any,
  type: number,
  pv: number,
): boolean {
  const equal = (a: any, b: any) => String(a ?? "") === String(b ?? "");
  const cents = (v: any) => Math.round(Number(v) * 100);
  return (
    Number(remote.CbteTipo) === type &&
    Number(remote.PtoVta) === pv &&
    [
      "Concepto",
      "DocTipo",
      "DocNro",
      "CbteDesde",
      "CbteHasta",
      "CbteFch",
      "MonId",
    ].every((k) => equal(detail[k], remote[k])) &&
    [
      "ImpTotal",
      "ImpNeto",
      "ImpIVA",
      "ImpOpEx",
      "ImpTotConc",
      "ImpTrib",
      "MonCotiz",
    ].every(
      (k) =>
        Number.isFinite(Number(remote[k])) &&
        cents(detail[k]) === cents(remote[k]),
    ) &&
    ["FchServDesde", "FchServHasta", "FchVtoPago"].every(
      (k) => !detail[k] || equal(detail[k], remote[k]),
    ) &&
    equal(detail.CondicionIVAReceptorId, remote.CondicionIVAReceptorId) &&
    list<any>(detail.Iva?.AlicIva).length ===
      list<any>(remote.Iva?.AlicIva).length &&
    list<any>(detail.Iva?.AlicIva).every((a) =>
      list<any>(remote.Iva?.AlicIva).some(
        (b) =>
          Number(a.Id) === Number(b.Id) &&
          cents(a.BaseImp) === cents(b.BaseImp) &&
          cents(a.Importe) === cents(b.Importe),
      ),
    ) &&
    list<any>(detail.CbtesAsoc?.CbteAsoc).length ===
      list<any>(remote.CbtesAsoc?.CbteAsoc).length &&
    list<any>(detail.CbtesAsoc?.CbteAsoc).every((a) =>
      list<any>(remote.CbtesAsoc?.CbteAsoc).some((b) =>
        ["Tipo", "PtoVta", "Nro", "Cuit", "CbteFch"].every((k) =>
          equal(a[k], b[k]),
        ),
      ),
    )
  );
}
