import { Request, Response } from 'express';
import {
  sendInvoiceToAfip,
  sendCatalogInvoiceToAfip,
  sendStoreOrderToAfip,
  getAfipStats,
  type AfipSendParams,
} from '../services/afip.service';
import logger from '../utils/logger';

function extractParams(body: any): AfipSendParams {
  return {
    tipoComprobante:     Number(body.tipoComprobante),
    concepto:            Number(body.concepto),
    ivaAlicuota:         Number(body.ivaAlicuota),
    docTipo:             Number(body.docTipo),
    docNro:              String(body.docNro ?? ''),
    condicionIvaReceptor: Number(body.condicionIvaReceptor),
    totalAmount:         0, // se sobreescribe desde el modelo
  };
}

export async function sendInvoice(req: Request, res: Response) {
  try {
    const invoice = await sendInvoiceToAfip(Number(req.params.id), extractParams(req.body));
    res.json({ ok: true, invoice });
  } catch (err: any) {
    logger.error('afip.sendInvoice', err);
    res.status(422).json({ error: err.message });
  }
}

export async function sendCatalogInvoice(req: Request, res: Response) {
  try {
    const invoice = await sendCatalogInvoiceToAfip(Number(req.params.id), extractParams(req.body));
    res.json({ ok: true, invoice });
  } catch (err: any) {
    logger.error('afip.sendCatalogInvoice', err);
    res.status(422).json({ error: err.message });
  }
}

export async function sendStoreOrder(req: Request, res: Response) {
  try {
    const order = await sendStoreOrderToAfip(Number(req.params.id), extractParams(req.body));
    res.json({ ok: true, order });
  } catch (err: any) {
    logger.error('afip.sendStoreOrder', err);
    res.status(422).json({ error: err.message });
  }
}

export async function afipStats(req: Request, res: Response) {
  try {
    const stats = await getAfipStats();
    res.json(stats);
  } catch (err: any) {
    logger.error('afip.stats', err);
    res.status(500).json({ error: err.message });
  }
}
