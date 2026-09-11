import type { Transaction } from "sequelize";
import { AfipDocument, AfipTarget } from "../models/AfipDocument";
import { AppError } from "../middlewares/errorHandler";

/** Anular administrativamente no sustituye la nota de crédito. */
export async function assertFiscalCancellation(
  target: AfipTarget,
  id: number,
  legacyStatus: string | null | undefined,
  transaction?: Transaction,
) {
  if (legacyStatus === "pending")
    throw new AppError(
      "Recuperar primero el comprobante fiscal pendiente",
      409,
    );
  const docs = await AfipDocument.findAll({
    where: { target, target_id: id, environment: "prod" },
    transaction,
  });
  if (docs.some((d) => ["prepared", "uncertain"].includes(d.status)))
    throw new AppError("Hay una emisión fiscal pendiente de recuperar", 409);
  const original = docs.find(
    (d) => d.status === "sent" && d.snapshot.kind === "invoice",
  );
  if (!original) {
    if (legacyStatus && docs.length === 0)
      throw new AppError(
        "Comprobante fiscal anterior sin registro de ajustes. Requiere conciliación fiscal",
        409,
      );
    return;
  }
  const credits = docs
    .filter((d) => d.status === "sent" && d.snapshot.originalId === original.id)
    .reduce((sum, d) => sum + Math.round(d.snapshot.detail.ImpTotal * 100), 0);
  if (credits < Math.round(original.snapshot.detail.ImpTotal * 100))
    throw new AppError(
      "Emitir la nota de crédito por el saldo fiscal antes de anular el documento",
      409,
    );
}
