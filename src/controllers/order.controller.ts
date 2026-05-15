import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as orderService from '../services/order.service';
import { generateOrderPDF } from '../utils/pdf';

export async function listOrders(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string | undefined;
    const client_id = req.query.client_id ? parseInt(req.query.client_id as string) : undefined;
    const seller_id = req.query.seller_id ? parseInt(req.query.seller_id as string) : undefined;
    const order_number = req.query.order_number as string | undefined;
    const date_from = req.query.date_from as string | undefined;
    const date_to = req.query.date_to as string | undefined;
    const delivery_date_from = req.query.delivery_date_from as string | undefined;
    const delivery_date_to = req.query.delivery_date_to as string | undefined;

    const result = await orderService.listOrders(req.user!, {
      page, limit,
      status: status as any,
      client_id, seller_id, order_number,
      date_from, date_to, delivery_date_from, delivery_date_to,
    });

    res.json({
      success: true,
      data: result.orders,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function getOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // Pasa el usuario para que el service aplique restricciones de seller
    const order = await orderService.getOrderById(parseInt(req.params.id), req.user!);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    // seller_id desde body (solo admin/billing pueden especificarlo explícitamente)
    const sellerIdOverride =
      req.body.seller_id && req.user!.role !== 'seller'
        ? parseInt(req.body.seller_id)
        : undefined;

    const order = await orderService.createOrder(req.body, req.user!, sellerIdOverride);
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

export async function updateOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await orderService.updateOrder(
      parseInt(req.params.id),
      req.body,
      req.user!
    );
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

export async function deleteOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await orderService.deleteOrder(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Pedido eliminado' } });
  } catch (err) {
    next(err);
  }
}

export async function uploadImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
      return;
    }

    const image = await orderService.uploadOrderImage(
      parseInt(req.params.id),
      req.file,
      req.body.description,
      req.user!
    );

    res.status(201).json({ success: true, data: image });
  } catch (err) {
    next(err);
  }
}

export async function deleteImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await orderService.deleteOrderImage(
      parseInt(req.params.id),
      parseInt(req.params.imgId)
    );
    res.json({ success: true, data: { message: 'Imagen eliminada' } });
  } catch (err) {
    next(err);
  }
}

export async function getOrderPDF(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await orderService.getOrderById(parseInt(req.params.id), req.user!);
    const pdfBuffer = await generateOrderPDF(order);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="pedido-${order.order_number}.pdf"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

export async function getOrderHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const history = await orderService.getOrderHistory(parseInt(req.params.id));
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}
