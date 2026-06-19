import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/invoice.controller';

const router = Router();

router.use(authenticate);

// Todos los roles autenticados pueden ver facturas (filtradas por rol en el service)
router.get('/', ctrl.listInvoices);
router.get('/by-order/:orderId', [param('orderId').isInt({ min: 1 }), validate], ctrl.getInvoiceByOrder);
router.get('/:id', [param('id').isInt({ min: 1 }), validate], ctrl.getInvoice);
router.get('/:id/pdf', [param('id').isInt({ min: 1 }), validate], ctrl.getInvoicePDF);

// Solo admin y billing pueden modificar
router.put(
  '/:id',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('status').optional().isIn(['draft', 'issued', 'paid', 'cancelled']),
    body('due_date').optional().isISO8601(),
    body('notes').optional().isString(),
    body('discount_amount').optional().isFloat({ min: 0 }),
    body('extra_items').optional().isArray(),
    body('extra_items.*.description').optional().isString(),
    body('extra_items.*.amount').optional().isFloat(),
    validate,
  ],
  ctrl.updateInvoice
);

router.post(
  '/:id/payments',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0'),
    body('notes').optional().isString(),
    validate,
  ],
  ctrl.addInvoicePayment
);

export default router;
