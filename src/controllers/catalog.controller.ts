import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as catalogService from '../services/catalog.service';
import { storeEvents } from '../events/storeEvents';

// ─── Productos ────────────────────────────────────────────────────────────────

export async function listClientProducts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientId = parseInt(req.params.clientId);
    const products = await catalogService.listClientProducts(clientId);
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

export async function listProducts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const clientId = req.query.client_id ? parseInt(req.query.client_id as string) : undefined;
    const result = await catalogService.listAllProducts(page, limit, clientId);
    res.json({ success: true, data: result.products, meta: { page: result.page, limit: result.limit, total: result.total } });
  } catch (err) { next(err); }
}

export async function getProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.getProduct(parseInt(req.params.id));
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function createProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.createProduct(req.body);
    storeEvents.emit('products_changed');
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.updateProduct(parseInt(req.params.id), req.body);
    storeEvents.emit('products_changed');
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { soft } = await catalogService.deleteProduct(parseInt(req.params.id));
    storeEvents.emit('products_changed');
    const message = soft
      ? 'El producto tiene pedidos asociados y fue desactivado (no eliminado)'
      : 'Producto eliminado';
    res.json({ success: true, data: { message, soft } });
  } catch (err) { next(err); }
}

export async function adjustProductStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.adjustProductStock(
      parseInt(req.params.id),
      parseInt(req.body.stock_quantity)
    );
    storeEvents.emit('products_changed');
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function saveProductSizes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sizes = await catalogService.saveProductSizes(parseInt(req.params.id), req.body.sizes ?? []);
    storeEvents.emit('products_changed');
    res.json({ success: true, data: sizes });
  } catch (err) { next(err); }
}

// ─── Imágenes de producto ─────────────────────────────────────────────────────

export async function uploadProductImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No se envió ninguna imagen' });
      return;
    }
    const image = await catalogService.addProductImage(parseInt(req.params.id), req.file);
    storeEvents.emit('products_changed');
    res.status(201).json({ success: true, data: image });
  } catch (err) { next(err); }
}

export async function deleteProductImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteProductImage(parseInt(req.params.imageId));
    storeEvents.emit('products_changed');
    res.json({ success: true, data: { message: 'Imagen eliminada' } });
  } catch (err) { next(err); }
}

// ─── Pedidos del catálogo ─────────────────────────────────────────────────────

export async function listCatalogInvoices(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await catalogService.listCatalogInvoices(page, limit, {
      status:    req.query.status    as string | undefined,
      client_id: req.query.client_id ? parseInt(req.query.client_id as string) : undefined,
      seller_id: req.query.seller_id ? parseInt(req.query.seller_id as string) : undefined,
      date_from: req.query.date_from as string | undefined,
      date_to:   req.query.date_to   as string | undefined,
    });
    res.json({ success: true, data: result.invoices, meta: { page: result.page, limit: result.limit, total: result.total } });
  } catch (err) { next(err); }
}

export async function listCatalogOrders(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const filters = {
      client_id: req.query.client_id ? parseInt(req.query.client_id as string) : undefined,
      seller_id: req.query.seller_id ? parseInt(req.query.seller_id as string) : undefined,
      status: req.query.status as string | undefined,
    };
    const result = await catalogService.listCatalogOrders(page, limit, filters);
    res.json({ success: true, data: result.orders, meta: { page: result.page, limit: result.limit, total: result.total } });
  } catch (err) { next(err); }
}

export async function getCatalogOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await catalogService.getCatalogOrder(parseInt(req.params.id));
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
}

export async function createCatalogOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await catalogService.createCatalogOrder({
      ...req.body,
      seller_id: req.body.seller_id || req.user!.id,
    });
    res.status(201).json({ success: true, data: order });
  } catch (err) { next(err); }
}

export async function updateCatalogOrderStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await catalogService.updateCatalogOrderStatus(
      parseInt(req.params.id),
      req.body.status
    );
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
}

export async function initiateCatalogPayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const customAmount = req.body.amount != null ? Number(req.body.amount) : undefined;
    const result = await catalogService.initiateCatalogPayment(
      parseInt(req.params.id),
      {
        success: `${frontendUrl}/catalog/orders?payment=success`,
        failure: `${frontendUrl}/catalog/orders?payment=failure`,
        pending: `${frontendUrl}/catalog/orders?payment=pending`,
      },
      customAmount
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getCatalogInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await catalogService.getCatalogInvoice(parseInt(req.params.id));
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function addCatalogInvoicePayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await catalogService.addPaymentToCatalogInvoice(
      parseInt(req.params.id),
      Number(req.body.amount),
      req.body.notes
    );
    res.status(201).json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function updateCatalogInvoiceStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await catalogService.updateCatalogInvoiceStatus(
      parseInt(req.params.id),
      req.body.status,
      req.body.payment_amount != null ? Number(req.body.payment_amount) : undefined
    );
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function uploadInvoiceImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No se envió ninguna imagen' });
      return;
    }
    const image = await catalogService.addInvoiceImage(
      parseInt(req.params.id),
      req.file,
      req.user?.id
    );
    res.status(201).json({ success: true, data: image });
  } catch (err) { next(err); }
}

export async function deleteInvoiceImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteInvoiceImage(parseInt(req.params.imageId));
    res.json({ success: true, data: { message: 'Imagen eliminada' } });
  } catch (err) { next(err); }
}

export async function mpWebhook(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const paymentId = req.query['data.id'] as string || req.body?.data?.id;
    if (paymentId) {
      await catalogService.handleMPWebhook(String(paymentId));
    }
    res.sendStatus(200);
  } catch (err) { next(err); }
}
