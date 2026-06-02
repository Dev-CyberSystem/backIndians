import { Response, NextFunction } from 'express';
import { AuthRequest, InvoiceStatus } from '../types';
import * as invoiceService from '../services/invoice.service';
import * as settingsService from '../services/settings.service';
import { generateInvoicePDF } from '../utils/pdf';

export async function listInvoices(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await invoiceService.listInvoices(req.user!, {
      page,
      limit,
      invoice_number: req.query.invoice_number as string | undefined,
      status:         req.query.status         as InvoiceStatus | undefined,
      client_id:      req.query.client_id  ? parseInt(req.query.client_id  as string) : undefined,
      seller_id:      req.query.seller_id  ? parseInt(req.query.seller_id  as string) : undefined,
      date_from:      req.query.date_from  as string | undefined,
      date_to:        req.query.date_to    as string | undefined,
    });
    res.json({
      success: true,
      data: result.invoices,
      meta: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) { next(err); }
}

export async function getInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await invoiceService.getInvoiceById(parseInt(req.params.id), req.user!);
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function updateInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await invoiceService.updateInvoice(parseInt(req.params.id), req.body, req.user!);
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function getInvoiceByOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await invoiceService.getInvoiceByOrderId(parseInt(req.params.orderId));
    if (!invoice) {
      res.status(404).json({ success: false, message: 'Factura no encontrada para este pedido' });
      return;
    }
    res.json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function getInvoicePDF(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice  = await invoiceService.getInvoiceById(parseInt(req.params.id), req.user!);
    const settings = await settingsService.getAllSettings();
    const pdfBuffer = await generateInvoicePDF(invoice, settings);

    const filename = `factura-${invoice.invoice_number}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(pdfBuffer);
  } catch (err) { next(err); }
}
