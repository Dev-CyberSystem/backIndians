import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/product.controller';

const router = Router();

router.use(authenticate);

router.get('/', ctrl.listProducts);

router.post(
  '/',
  authorize('admin'),
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('base_price').isFloat({ min: 0 }).withMessage('Precio base inválido'),
    validate,
  ],
  ctrl.createProduct
);

router.put(
  '/:id',
  authorize('admin'),
  [
    param('id').isInt({ min: 1 }),
    body('base_price').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.updateProduct
);

router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteProduct
);

export default router;
