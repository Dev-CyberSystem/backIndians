import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { AfipDocument } from "../models/AfipDocument";

const labels: Record<number, string> = {
  1: "FACTURA A",
  6: "FACTURA B",
  11: "FACTURA C",
  3: "NOTA DE CRÉDITO A",
  8: "NOTA DE CRÉDITO B",
  13: "NOTA DE CRÉDITO C",
};
const conditions: Record<number, string> = {
  1: "Responsable Inscripto",
  4: "Exento",
  5: "Consumidor Final",
  6: "Monotributista",
};
const money = (n: number) =>
  "$ " +
  Number(n).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const date = (v: string) =>
  String(v).replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1");
export function fiscalQrPayload(
  doc: Pick<AfipDocument, "snapshot" | "response">,
) {
  const s = doc.snapshot,
    d = s.detail;
  return {
    ver: 1,
    fecha: String(d.CbteFch).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
    cuit: Number(s.cuit),
    ptoVta: s.pv,
    tipoCmp: s.type,
    nroCmp: d.CbteDesde,
    importe: d.ImpTotal,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: d.DocTipo,
    nroDocRec: Number(d.DocNro),
    tipoCodAut: "E",
    codAut: Number(doc.response.authorization.CAE),
  };
}
export async function generateFiscalPdf(
  record: Pick<
    AfipDocument,
    "snapshot" | "response" | "environment" | "status"
  >,
): Promise<Buffer> {
  if (record.status !== "sent" || !record.response?.authorization?.CAE)
    throw new Error("Solo se genera PDF fiscal con autorización");
  const s = record.snapshot,
    d = s.detail,
    auth = record.response.authorization;
  const url =
    "https://www.arca.gob.ar/fe/qr/?p=" +
    Buffer.from(JSON.stringify(fiscalQrPayload(record))).toString("base64");
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 300,
  });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
      info: { Title: labels[s.type] + " " + s.pv + "-" + d.CbteDesde },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const text = (
      v: string,
      x: number,
      y: number,
      width: number,
      size = 9,
      bold = false,
    ) =>
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .fillColor("#18212d")
        .text(v, x, y, { width });
    const line = (y: number) =>
      doc
        .moveTo(40, y)
        .lineTo(555, y)
        .strokeColor("#c5ccd4")
        .lineWidth(0.6)
        .stroke();
    function header(continuation = false) {
      text(
        record.environment === "homo"
          ? "HOMOLOGACIÓN - SIN VALIDEZ FISCAL"
          : "ORIGINAL",
        40,
        30,
        515,
        10,
        true,
      );
      text(s.issuer.company_name, 40, 53, 270, 14, true);
      const issuerY = doc.y + 8;
      text(labels[s.type] || "COMPROBANTE", 325, 55, 230, 15, true);
      text("Código " + String(s.type).padStart(3, "0"), 325, 77, 230);
      text(
        String(s.pv).padStart(5, "0") +
          "-" +
          String(d.CbteDesde).padStart(8, "0"),
        325,
        94,
        230,
        14,
        true,
      );
      text("Fecha: " + date(d.CbteFch), 325, 116, 230);
      text(
        "CUIT: " +
          s.cuit +
          "\n" +
          s.issuer.company_iva_condition +
          "\n" +
          s.issuer.company_address +
          "\nIngresos Brutos: " +
          s.issuer.company_iibb +
          "\nInicio de actividades: " +
          s.issuer.company_activity_start,
        40,
        issuerY,
        270,
        8,
      );
      let next = Math.max(160, doc.y + 12);
      line(next);
      text("RECEPTOR", 40, next + 12, 515, 8, true);
      text(s.params.receptorNombre, 40, doc.y + 8, 515, 11, true);
      text(
        (d.DocTipo === 80 ? "CUIT: " : "DNI: ") +
          d.DocNro +
          " | " +
          conditions[d.CondicionIVAReceptorId],
        40,
        doc.y + 7,
        515,
      );
      text(s.params.receptorDomicilio, 40, doc.y + 7, 515, 8);
      text(
        "Referencia: " +
          s.source.reference +
          (continuation ? " | Continuación" : ""),
        40,
        doc.y + 10,
        515,
        8,
      );
      if (d.FchServDesde)
        text(
          "Servicio: " +
            date(d.FchServDesde) +
            " al " +
            date(d.FchServHasta) +
            " | Vencimiento pago: " +
            date(d.FchVtoPago),
          40,
          doc.y + 7,
          515,
          8,
        );
      next = doc.y + 12;
      line(next);
      text("DESCRIPCIÓN", 40, next + 12, 310, 8, true);
      text("CANT.", 360, next + 12, 45, 8, true);
      text("P. UNIT.", 415, next + 12, 65, 8, true);
      text("IMPORTE", 490, next + 12, 65, 8, true);
      line(next + 28);
      return next + 40;
    }
    let y = header();
    const rows =
      s.kind === "credit"
        ? [
            {
              description: "Ajuste: " + s.reason,
              quantity: 1,
              unitPrice: d.ImpTotal,
              total: d.ImpTotal,
            },
          ]
        : [
            ...s.source.items,
            ...s.source.extras.map((e: any) => ({
              description: e.description,
              quantity: 1,
              unitPrice: e.amount,
              total: e.amount,
            })),
            ...(s.source.discount
              ? [
                  {
                    description: "Descuento",
                    quantity: 1,
                    unitPrice: -s.source.discount,
                    total: -s.source.discount,
                  },
                ]
              : []),
          ];
    for (const row of rows) {
      doc.font("Helvetica").fontSize(9);
      const height = Math.max(
        24,
        doc.heightOfString(String(row.description), { width: 300 }) + 10,
      );
      if (y + height > 580) {
        doc.addPage();
        y = header(true);
      }
      text(String(row.description), 40, y, 300);
      text(String(row.quantity), 360, y, 45);
      text(money(row.unitPrice), 410, y, 73, 8);
      text(money(row.total), 485, y, 70, 8);
      y += height;
      line(y - 5);
    }
    if (y > 510) {
      doc.addPage();
      y = header(true);
    }
    if (s.kind === "credit") {
      const a = d.CbtesAsoc.CbteAsoc[0];
      text(
        "Asociado: tipo " +
          a.Tipo +
          " - " +
          String(a.PtoVta).padStart(5, "0") +
          "-" +
          String(a.Nro).padStart(8, "0") +
          " | Fecha " +
          date(a.CbteFch),
        40,
        y + 5,
        515,
        9,
      );
      y += 30;
    }
    text(
      ([11, 13].includes(s.type) ? "Importe neto: " : "Neto gravado: ") +
        money(d.ImpNeto) +
        "  |  Exento: " +
        money(d.ImpOpEx) +
        "  |  IVA: " +
        money(d.ImpIVA),
      40,
      y + 10,
      515,
      9,
    );
    if (d.Iva)
      text(
        "Alícuota IVA: " +
          s.params.ivaAlicuota +
          "% · Los precios del detalle son finales.",
        40,
        y + 27,
        290,
        8,
      );
    text("TOTAL " + money(d.ImpTotal), 330, y + 34, 225, 17, true);
    if ([6, 8].includes(s.type))
      text(
        "Régimen de Transparencia Fiscal al Consumidor\nIVA contenido: " +
          money(d.ImpIVA) +
          " | Otros impuestos nacionales indirectos: " +
          money(d.ImpTrib),
        40,
        y + 65,
        515,
        8,
      );
    if ([1, 3].includes(s.type) && d.CondicionIVAReceptorId === 6)
      text(
        "El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618",
        40,
        y + 65,
        515,
        8,
      );
    const count = doc.bufferedPageRange().count;
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      line(657);
      doc.image(qr, 40, 669, { width: 105, height: 105 });
      text("CAE: " + auth.CAE, 160, 684, 395, 12, true);
      text("Vencimiento CAE: " + date(auth.CAEFchVto), 160, 709, 395, 10);
      text(
        record.environment === "homo"
          ? "Comprobante de prueba. No válido para operaciones reales."
          : "Comprobante autorizado por ARCA.",
        160,
        734,
        395,
        9,
      );
      text("Página " + (i + 1) + " de " + count, 40, 789, 515, 8);
    }
    doc.end();
  });
}
