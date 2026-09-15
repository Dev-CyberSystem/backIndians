import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { AfipDocument } from "../models/AfipDocument";
import { drawIndiansLogo } from "./logo";

const labels: Record<number, string> = {
  1: "FACTURA A",
  6: "FACTURA B",
  11: "FACTURA C",
  3: "NOTA DE CRÉDITO A",
  8: "NOTA DE CRÉDITO B",
  13: "NOTA DE CRÉDITO C",
};

const letters: Record<number, string> = {
  1: "A",
  3: "A",
  6: "B",
  8: "B",
  11: "C",
  13: "C",
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

const date = (value: string) =>
  String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1");

export function fiscalQrPayload(
  doc: Pick<AfipDocument, "snapshot" | "response">,
) {
  const snapshot = doc.snapshot;
  const detail = snapshot.detail;
  return {
    ver: 1,
    fecha: String(detail.CbteFch).replace(
      /(\d{4})(\d{2})(\d{2})/,
      "$1-$2-$3",
    ),
    cuit: Number(snapshot.cuit),
    ptoVta: snapshot.pv,
    tipoCmp: snapshot.type,
    nroCmp: detail.CbteDesde,
    importe: detail.ImpTotal,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: detail.DocTipo,
    nroDocRec: Number(detail.DocNro),
    tipoCodAut: "E",
    codAut: Number(doc.response.authorization.CAE),
  };
}

type FiscalRow = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export async function generateFiscalPdf(
  record: Pick<
    AfipDocument,
    "snapshot" | "response" | "environment" | "status"
  >,
): Promise<Buffer> {
  if (record.status !== "sent" || !record.response?.authorization?.CAE) {
    throw new Error("Solo se genera PDF fiscal con autorización");
  }

  const snapshot = record.snapshot;
  const detail = snapshot.detail;
  const authorization = record.response.authorization;
  const label = labels[snapshot.type] || "COMPROBANTE";
  const letter = letters[snapshot.type] || "X";
  const qrUrl =
    "https://www.arca.gob.ar/fe/qr/?p=" +
    Buffer.from(JSON.stringify(fiscalQrPayload(record))).toString("base64");
  const qr = await QRCode.toBuffer(qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 3,
    width: 300,
  });

  const rows: FiscalRow[] =
    snapshot.kind === "credit"
      ? [
          {
            description: "Ajuste: " + snapshot.reason,
            quantity: 1,
            unitPrice: detail.ImpTotal,
            total: detail.ImpTotal,
          },
        ]
      : [
          ...snapshot.source.items,
          ...snapshot.source.extras.map((extra: any) => ({
            description: extra.description,
            quantity: 1,
            unitPrice: extra.amount,
            total: extra.amount,
          })),
          ...(snapshot.source.discount
            ? [
                {
                  description: "Descuento",
                  quantity: 1,
                  unitPrice: -snapshot.source.discount,
                  total: -snapshot.source.discount,
                },
              ]
            : []),
        ];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
      info: {
        Title: `${label} ${snapshot.pv}-${detail.CbteDesde}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 40;
    const R = 555;
    const W = R - L;
    const MID = 300;
    const TOP = 45;
    const BOTTOM = 800;
    const HEADER_BOTTOM = 205;
    const CLIENT_BOTTOM = detail.FchServDesde ? 326 : 304;
    const TABLE_TOP = CLIENT_BOTTOM;
    const TABLE_HEADER_HEIGHT = 20;
    const TABLE_CONTENT_TOP = TABLE_TOP + TABLE_HEADER_HEIGHT + 6;
    const TABLE_CONTENT_LIMIT = 555;
    const FOOT_TOP = 690;

    const cols = [
      { label: "CANT.", x: 40, width: 52, align: "center" as const },
      { label: "DESCRIPCIÓN", x: 92, width: 238, align: "left" as const },
      { label: "DETALLE", x: 330, width: 85, align: "left" as const },
      { label: "PRECIO UNIT.", x: 415, width: 70, align: "right" as const },
      { label: "IMPORTE", x: 485, width: 70, align: "right" as const },
    ];

    const rowHeight = (row: FiscalRow) => {
      doc.font("Helvetica").fontSize(8.5);
      return Math.min(
        46,
        Math.max(
          16,
          doc.heightOfString(String(row.description), {
            width: cols[1].width - 8,
          }) + 4,
        ),
      );
    };

    const pages: FiscalRow[][] = [];
    let pageRows: FiscalRow[] = [];
    let usedY = TABLE_CONTENT_TOP;
    for (const row of rows) {
      const height = rowHeight(row);
      if (pageRows.length && usedY + height > TABLE_CONTENT_LIMIT) {
        pages.push(pageRows);
        pageRows = [];
        usedY = TABLE_CONTENT_TOP;
      }
      pageRows.push(row);
      usedY += height;
    }
    pages.push(pageRows);

    const formField = (
      fieldLabel: string,
      value: string | number | null | undefined,
      x: number,
      y: number,
      width: number,
    ) => {
      doc.fontSize(8).font("Helvetica").fillColor("#333333");
      const labelWidth = doc.widthOfString(`${fieldLabel}: `);
      doc.text(`${fieldLabel}: `, x, y, { lineBreak: false });
      doc
        .font("Helvetica")
        .fillColor("#000000")
        .text(String(value ?? ""), x + labelWidth + 2, y, {
          width: width - labelWidth - 2,
          ellipsis: true,
          height: 10,
        });
      doc
        .lineWidth(0.5)
        .moveTo(x + labelWidth + 2, y + 10)
        .lineTo(x + width, y + 10)
        .stroke("#BBBBBB");
    };

    const drawHeader = (continuation: boolean) => {
      doc
        .lineWidth(1)
        .strokeColor("#000000")
        .rect(L, TOP, W, BOTTOM - TOP)
        .stroke();
      doc
        .moveTo(MID, TOP)
        .lineTo(MID, HEADER_BOTTOM)
        .stroke("#000000");
      doc
        .moveTo(L, HEADER_BOTTOM)
        .lineTo(R, HEADER_BOTTOM)
        .stroke("#000000");

      drawIndiansLogo(doc, 55, 56, 30);
      doc
        .fillColor("#333333")
        .fontSize(6.5)
        .font("Helvetica")
        .text("I N D U M E N T A R I A   D E P O R T I V A", 57, 90, {
          characterSpacing: 1,
        });
      doc
        .fillColor("#000000")
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(String(snapshot.issuer.company_name).toUpperCase(), 55, 111, {
          width: MID - 70,
          height: 14,
          ellipsis: true,
        });
      doc.fontSize(7.5).font("Helvetica");
      doc.text(`CUIT: ${snapshot.cuit}`, 55, 128);
      doc.text(
        `Condición frente al IVA: ${snapshot.issuer.company_iva_condition}`,
        55,
        140,
        { width: MID - 70 },
      );
      doc.text(String(snapshot.issuer.company_address), 55, 152, {
        width: MID - 70,
        height: 20,
        ellipsis: true,
      });
      doc.text(`Ingresos Brutos: ${snapshot.issuer.company_iibb}`, 55, 174, {
        width: MID - 70,
        height: 10,
        ellipsis: true,
      });
      doc.text(
        `Inicio de Actividades: ${snapshot.issuer.company_activity_start}`,
        55,
        186,
      );

      const boxSize = 46;
      const boxX = R - boxSize - 14;
      const boxY = TOP + 8;
      doc.lineWidth(1).rect(boxX, boxY, boxSize, boxSize).stroke("#000000");
      doc
        .fontSize(30)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text(letter, boxX, boxY + 8, { width: boxSize, align: "center" });
      doc
        .fontSize(label.startsWith("NOTA") ? 13 : 20)
        .font("Helvetica-Bold")
        .text(label.replace(/ [ABC]$/, ""), MID + 12, TOP + 20, {
          width: boxX - MID - 16,
          height: 34,
        });
      doc
        .fontSize(8.5)
        .font("Helvetica")
        .fillColor("#333333")
        .text(`Código N° ${String(snapshot.type).padStart(3, "0")}`, MID + 14, TOP + 50);
      doc
        .fontSize(17)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text(
          `N° ${String(snapshot.pv).padStart(5, "0")}-${String(detail.CbteDesde).padStart(8, "0")}`,
          MID + 12,
          TOP + 72,
          { width: R - MID - 24 },
        );
      doc
        .fontSize(9)
        .font("Helvetica")
        .text(`FECHA: ${date(detail.CbteFch)}`, MID + 14, TOP + 101);
      doc.text(
        `IVA: ${String(snapshot.issuer.company_iva_condition).toUpperCase()}`,
        MID + 14,
        TOP + 117,
        { width: R - MID - 28, height: 12, ellipsis: true },
      );
      if (record.environment === "homo") {
        doc
          .rect(MID + 12, TOP + 137, R - MID - 24, 18)
          .fillAndStroke("#F0F0F0", "#777777");
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor("#000000")
          .text("HOMOLOGACIÓN - SIN VALIDEZ FISCAL", MID + 17, TOP + 143, {
            width: R - MID - 34,
            align: "center",
          });
      }

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("DATOS DEL CLIENTE", 55, HEADER_BOTTOM + 8);
      const leftX = 55;
      const leftWidth = 235;
      const rightX = 310;
      const rightWidth = 235;
      const nameWidth = 300;
      const documentX = 375;
      const documentWidth = 170;
      let fieldY = HEADER_BOTTOM + 28;
      formField(
        "Razón Social / Nombre y Apellido",
        snapshot.params.receptorNombre,
        leftX,
        fieldY,
        nameWidth,
      );
      formField(
        detail.DocTipo === 80 ? "CUIT" : "DNI",
        detail.DocNro,
        documentX,
        fieldY,
        documentWidth,
      );
      fieldY += 22;
      formField(
        "Domicilio",
        snapshot.params.receptorDomicilio,
        leftX,
        fieldY,
        W - 30,
      );
      fieldY += 22;
      formField(
        "Condición IVA",
        conditions[detail.CondicionIVAReceptorId] || "",
        leftX,
        fieldY,
        leftWidth,
      );
      formField(
        continuation ? "Referencia / página" : "Referencia",
        continuation
          ? `${snapshot.source.reference} - continuación`
          : snapshot.source.reference,
        rightX,
        fieldY,
        rightWidth,
      );
      if (detail.FchServDesde) {
        fieldY += 22;
        formField(
          "Período del servicio",
          `${date(detail.FchServDesde)} al ${date(detail.FchServHasta)}`,
          leftX,
          fieldY,
          leftWidth,
        );
        formField(
          "Vencimiento de pago",
          date(detail.FchVtoPago),
          rightX,
          fieldY,
          rightWidth,
        );
      }
      doc
        .lineWidth(1)
        .moveTo(L, CLIENT_BOTTOM)
        .lineTo(R, CLIENT_BOTTOM)
        .stroke("#000000");
    };

    const drawTable = (items: FiscalRow[]) => {
      doc.rect(L, TABLE_TOP, W, TABLE_HEADER_HEIGHT).fill("#F0F0F0");
      doc.fillColor("#000000").fontSize(8).font("Helvetica-Bold");
      for (const col of cols) {
        const padding = col.align === "left" ? 4 : 0;
        doc.text(col.label, col.x + padding, TABLE_TOP + 7, {
          width: col.width - padding * 2,
          align: col.align,
        });
      }
      doc
        .lineWidth(0.75)
        .moveTo(L, TABLE_TOP + TABLE_HEADER_HEIGHT)
        .lineTo(R, TABLE_TOP + TABLE_HEADER_HEIGHT)
        .stroke("#000000");

      let y = TABLE_CONTENT_TOP;
      for (const row of items) {
        const height = rowHeight(row);
        doc.font("Helvetica").fontSize(8.5).fillColor("#000000");
        doc.text(String(row.quantity), cols[0].x, y, {
          width: cols[0].width,
          align: "center",
        });
        doc.text(String(row.description), cols[1].x + 4, y, {
          width: cols[1].width - 8,
          height: height - 2,
          ellipsis: true,
        });
        doc.text("—", cols[2].x + 4, y, { width: cols[2].width - 8 });
        doc.text(money(row.unitPrice), cols[3].x, y, {
          width: cols[3].width,
          align: "right",
        });
        doc.text(money(row.total), cols[4].x, y, {
          width: cols[4].width,
          align: "right",
        });
        y += height;
      }

      const tableBottom = Math.max(y + 6, TABLE_TOP + TABLE_HEADER_HEIGHT + 60);
      doc.lineWidth(0.5).strokeColor("#CCCCCC");
      for (let index = 1; index < cols.length; index += 1) {
        doc
          .moveTo(cols[index].x, TABLE_TOP)
          .lineTo(cols[index].x, tableBottom)
          .stroke("#CCCCCC");
      }
      doc
        .lineWidth(1)
        .moveTo(L, tableBottom)
        .lineTo(R, tableBottom)
        .stroke("#000000");
      return tableBottom;
    };

    const drawTotals = (tableBottom: number) => {
      const labelX = 380;
      const valueX = 470;
      const valueWidth = R - valueX - 6;
      let totalsY = tableBottom + 10;
      const totalRow = (rowLabel: string, value: string, bold = false) => {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 12 : 9)
          .fillColor("#000000");
        doc.text(rowLabel, labelX, totalsY, {
          width: valueX - labelX - 6,
        });
        doc.text(value, valueX, totalsY, {
          width: valueWidth,
          align: "right",
        });
        doc
          .lineWidth(0.5)
          .moveTo(valueX, totalsY + (bold ? 16 : 13))
          .lineTo(R - 6, totalsY + (bold ? 16 : 13))
          .stroke("#BBBBBB");
        totalsY += bold ? 22 : 18;
      };

      totalRow("SUBTOTAL", money(detail.ImpNeto + detail.ImpOpEx));
      if (detail.ImpOpEx > 0) totalRow("EXENTO", money(detail.ImpOpEx));
      if (![11, 13].includes(snapshot.type)) {
        totalRow("IVA", money(detail.ImpIVA));
      }
      totalRow("TOTAL", money(detail.ImpTotal), true);

      doc.fontSize(8).font("Helvetica").fillColor("#333333");
      let noteY = tableBottom + 10;
      doc.text(`Referencia: ${snapshot.source.reference}`, 55, noteY, {
        width: 300,
      });
      noteY += 13;
      if ([11, 13].includes(snapshot.type)) {
        doc.text("IVA no discriminado", 55, noteY, { width: 300 });
        noteY += 13;
      } else if (detail.Iva) {
        doc.text(
          `Alícuota IVA: ${snapshot.params.ivaAlicuota}% - precios finales`,
          55,
          noteY,
          { width: 300 },
        );
        noteY += 13;
      }
      if (snapshot.kind === "credit") {
        const associated = detail.CbtesAsoc.CbteAsoc[0];
        doc.text(
          `Comprobante asociado: ${String(associated.PtoVta).padStart(5, "0")}-${String(associated.Nro).padStart(8, "0")} (${date(associated.CbteFch)})`,
          55,
          noteY,
          { width: 300 },
        );
        noteY += 13;
        doc.text(`Motivo: ${snapshot.reason}`, 55, noteY, {
          width: 300,
          height: 25,
          ellipsis: true,
        });
      }
      if ([6, 8].includes(snapshot.type)) {
        doc.text(
          `Régimen de Transparencia Fiscal al Consumidor - IVA contenido: ${money(detail.ImpIVA)} - Otros impuestos nacionales indirectos: ${money(detail.ImpTrib)}`,
          55,
          noteY,
          { width: 300, height: 28 },
        );
      }
      if ([1, 3].includes(snapshot.type) && detail.CondicionIVAReceptorId === 6) {
        doc.fontSize(6.5).text(
          "El crédito fiscal discriminado sólo podrá computarse según el Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.",
          55,
          noteY,
          { width: 300, height: 30 },
        );
      }
    };

    const drawFooter = (pageNumber: number, pageCount: number) => {
      doc
        .lineWidth(1)
        .moveTo(L, FOOT_TOP)
        .lineTo(R, FOOT_TOP)
        .stroke("#000000");
      const qrSize = 68;
      const qrX = 55;
      const qrY = FOOT_TOP + 12;
      doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });

      const caeX = qrX + qrSize + 16;
      doc
        .fillColor("#000000")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(`CAE: ${authorization.CAE}`, caeX, qrY + 2, { width: 230 });
      doc
        .fontSize(8)
        .font("Helvetica")
        .text(`Vencimiento CAE: ${date(authorization.CAEFchVto)}`, caeX, qrY + 19, {
          width: 230,
        });
      doc.text(
        record.environment === "homo"
          ? "Comprobante de prueba - sin validez fiscal"
          : "Comprobante autorizado por ARCA",
        caeX,
        qrY + 36,
        { width: 230 },
      );
      doc.fontSize(7).fillColor("#555555").text(
        `Página ${pageNumber} de ${pageCount}`,
        caeX,
        qrY + 53,
        { width: 230 },
      );

      doc
        .lineWidth(0.5)
        .moveTo(R - 170, qrY + 46)
        .lineTo(R - 6, qrY + 46)
        .stroke("#000000");
      doc
        .fontSize(8)
        .fillColor("#333333")
        .font("Helvetica")
        .text("Firma y Aclaración", R - 170, qrY + 50, {
          width: 164,
          align: "center",
        })
        .text("Recibí conforme", R - 170, qrY + 62, {
          width: 164,
          align: "center",
        });

      doc
        .lineWidth(0.5)
        .moveTo(L, BOTTOM - 24)
        .lineTo(R, BOTTOM - 24)
        .stroke("#CCCCCC");
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#333333")
        .text("www.indians.com.ar", L, BOTTOM - 18, {
          width: W,
          align: "center",
        });
    };

    pages.forEach((items, index) => {
      if (index > 0) doc.addPage();
      drawHeader(index > 0);
      const tableBottom = drawTable(items);
      if (index === pages.length - 1) {
        drawTotals(tableBottom);
      } else {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor("#333333")
          .text("Continúa en la página siguiente", 55, tableBottom + 12, {
            width: W - 30,
          });
      }
      drawFooter(index + 1, pages.length);
    });

    doc.end();
  });
}
