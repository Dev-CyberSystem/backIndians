import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as catalogService from '../services/catalog.service';

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
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.updateProduct(parseInt(req.params.id), req.body);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteProduct(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Producto eliminado' } });
  } catch (err) { next(err); }
}

export async function adjustProductStock(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.adjustProductStock(
      parseInt(req.params.id),
      parseInt(req.body.stock_quantity)
    );
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function saveProductSizes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sizes = await catalogService.saveProductSizes(parseInt(req.params.id), req.body.sizes ?? []);
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
    res.status(201).json({ success: true, data: image });
  } catch (err) { next(err); }
}

export async function deleteProductImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteProductImage(parseInt(req.params.imageId));
    res.json({ success: true, data: { message: 'Imagen eliminada' } });
  } catch (err) { next(err); }
}

// ─── Pedidos del catálogo ─────────────────────────────────────────────────────

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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const order = await catalogService.createCatalogOrder({
      ...req.body,
      seller_id: req.body.seller_id || req.user!.id,
      back_urls: {
        success: `${frontendUrl}/catalog/orders?payment=success`,
        failure: `${frontendUrl}/catalog/orders?payment=failure`,
        pending: `${frontendUrl}/catalog/orders?payment=pending`,
      },
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
    const result = await catalogService.initiateCatalogPayment(parseInt(req.params.id), {
      success: `${frontendUrl}/catalog/orders?payment=success`,
      failure: `${frontendUrl}/catalog/orders?payment=failure`,
      pending: `${frontendUrl}/catalog/orders?payment=pending`,
    });
    res.json({ success: true, data: result });
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
