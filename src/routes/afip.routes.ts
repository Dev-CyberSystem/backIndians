import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/afip.controller';

const router = Router();
router.use(authenticate);

const sendValidation = [
  body('tipoComprobante').isInt({ min: 1 }).withMessage('tipoComprobante requerido'),
  body('concepto').isInt({ min: 1, max: 3 }).withMessage('concepto inválido'),
  body('ivaAlicuota').isFloat({ min: 0 }).withMessage('ivaAlicuota inválida'),
  body('docTipo').isInt({ min: 0 }).withMessage('docTipo requerido'),
  body('docNro').isString().withMessage('docNro requerido'),
  body('condicionIvaReceptor').isInt({ min: 1 }).withMessage('condicionIvaReceptor requerido'),
  validate,
];

router.post(
  '/invoices/:id/afip',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), ...sendValidation],
  ctrl.sendInvoice
);

router.post(
  '/catalog/invoices/:id/afip',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), ...sendValidation],
  ctrl.sendCatalogInvoice
);

router.post(
  '/store/orders/:id/afip',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), ...sendValidation],
  ctrl.sendStoreOrder
);

router.get('/afip/stats', authorize('admin', 'billing'), ctrl.afipStats);

export default router;
