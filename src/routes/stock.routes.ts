import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/stock.controller';

const router = Router();

router.use(authenticate, authorize('admin', 'billing'));

router.get('/', ctrl.listStock);

router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('unit').notEmpty().withMessage('Unidad requerida'),
    body('current_quantity').optional().isFloat({ min: 0 }),
    body('min_quantity').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.createStock
);

router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body('current_quantity').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.updateStock
);

router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteStock
);

export default router;
