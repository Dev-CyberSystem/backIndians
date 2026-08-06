import { Transaction } from 'sequelize';
import { AppError } from '../middlewares/errorHandler';
import { CatalogProduct } from '../models/CatalogProduct';
import { CatalogProductSize } from '../models/CatalogProductSize';
import { CatalogStockMovement, type CatalogStockMovementType, type CatalogStockMovementSource } from '../models/CatalogStockMovement';

/**
 * Único punto del sistema autorizado a modificar catalog_products/
 * catalog_product_sizes .stock_quantity y .stock_reserved. Cierra C-5: cada
 * cambio queda registrado en catalog_stock_movements dentro de la misma
 * transacción, con cantidad anterior/resultante, motivo, origen y responsable.
 *
 * Siempre requiere una transacción del caller (nunca abre la propia) para
 * poder participar de transacciones más grandes (checkout, pedido mayorista).
 */

export type StockField = 'stock_quantity' | 'stock_reserved';

export interface AdjustStockParams {
  transaction: Transaction;
  type: CatalogStockMovementType;
  source: CatalogStockMovementSource;
  catalogProductId: number;
  /** Si se da, ajusta catalog_product_sizes; si no, ajusta catalog_products. */
  catalogProductSizeId?: number | null;
  /**
   * Campo a modificar. 'stock_quantity' (default) = stock físico real.
   * 'stock_reserved' (2.1) = contador de reservas de pedidos pending_payment
   * — disponible para vender = stock_quantity - stock_reserved.
   */
  field?: StockField;
  /** Cambio relativo (negativo = descuento, positivo = alta). Exclusivo con setTo. */
  delta?: number;
  /** Cantidad absoluta a fijar (usado por ajustes manuales tipo inventario físico). Exclusivo con delta. */
  setTo?: number;
  /**
   * Si true: para field='stock_quantity', un resultado negativo lanza 409 en
   * vez de permitirlo. Para field='stock_reserved', valida que la reserva no
   * supere el stock físico real (stock_reserved no puede ser mayor a
   * stock_quantity) en vez de solo chequear negatividad.
   */
  requireAvailable?: boolean;
  reason?: string | null;
  storeOrderId?: number | null;
  catalogOrderId?: number | null;
  userId?: number | null;
  notes?: string | null;
}

export interface AdjustStockResult {
  previousQuantity: number;
  newQuantity: number;
  movement: CatalogStockMovement;
}

export async function adjustStock(params: AdjustStockParams): Promise<AdjustStockResult> {
  const {
    transaction, type, source, catalogProductId, catalogProductSizeId = null,
    field = 'stock_quantity', delta, setTo, requireAvailable = false, reason = null,
    storeOrderId = null, catalogOrderId = null, userId = null, notes = null,
  } = params;

  if ((delta == null) === (setTo == null)) {
    throw new AppError('adjustStock requiere exactamente uno de delta o setTo', 500);
  }

  // Re-lee con lock exclusivo dentro de la transacción del caller para
  // prevenir carreras entre ajustes concurrentes sobre la misma fila.
  let previousQuantity: number;
  let newQuantity: number;

  if (catalogProductSizeId) {
    const size = await CatalogProductSize.findByPk(catalogProductSizeId, { lock: Transaction.LOCK.UPDATE, transaction });
    if (!size) throw new AppError('Talle no encontrado para ajustar stock', 404);
    previousQuantity = size[field];
    newQuantity = delta != null ? previousQuantity + delta : (setTo as number);
    if (newQuantity < 0) {
      throw new AppError(requireAvailable ? 'Stock insuficiente' : 'El stock no puede quedar negativo', requireAvailable ? 409 : 400);
    }
    if (field === 'stock_reserved' && requireAvailable && newQuantity > size.stock_quantity) {
      throw new AppError('Stock insuficiente', 409);
    }
    await size.update({ [field]: newQuantity }, { transaction });
  } else {
    const product = await CatalogProduct.findByPk(catalogProductId, { lock: Transaction.LOCK.UPDATE, transaction });
    if (!product) throw new AppError('Producto no encontrado para ajustar stock', 404);
    previousQuantity = product[field];
    newQuantity = delta != null ? previousQuantity + delta : (setTo as number);
    if (newQuantity < 0) {
      throw new AppError(requireAvailable ? 'Stock insuficiente' : 'El stock no puede quedar negativo', requireAvailable ? 409 : 400);
    }
    if (field === 'stock_reserved' && requireAvailable && newQuantity > product.stock_quantity) {
      throw new AppError('Stock insuficiente', 409);
    }
    await product.update({ [field]: newQuantity }, { transaction });
  }

  const movement = await CatalogStockMovement.create(
    {
      catalog_product_id: catalogProductId,
      catalog_product_size_id: catalogProductSizeId,
      type,
      quantity: Math.abs(newQuantity - previousQuantity),
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      reason,
      source,
      store_order_id: storeOrderId,
      catalog_order_id: catalogOrderId,
      user_id: userId,
      notes,
    },
    { transaction }
  );

  return { previousQuantity, newQuantity, movement };
}
