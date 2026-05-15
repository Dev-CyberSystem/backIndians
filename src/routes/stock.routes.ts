import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/stock.controller';

const router = Router();

router.use(authenticate, authorize('admin', 'billing', 'workshop'));

// ── Métricas (antes de /:id para evitar conflictos de ruta) ──────────────────
router.get('/metrics', ctrl.getMetrics);

// ── Categorías ────────────────────────────────────────────────────────────────
router.get('/categories', ctrl.listCategories);

router.post(
  '/categories',
  authorize('admin', 'billing'),
  [body('name').notEmpty().withMessage('Nombre requerido'), validate],
  ctrl.createCategory
);

router.put(
  '/categories/:id',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), body('name').notEmpty(), validate],
  ctrl.updateCategory
);

router.delete(
  '/categories/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteCategory
);

// ── Movimientos ───────────────────────────────────────────────────────────────
router.get(
  '/movements',
  [query('stock_item_id').optional().isInt({ min: 1 }), validate],
  ctrl.listMovements
);

router.post(
  '/movements',
  [
    body('stock_item_id').isInt({ min: 1 }),
    body('type').isIn(['in', 'out', 'adjustment']),
    body('quantity').isFloat({ min: 0.001 }).withMessage('Cantidad debe ser mayor a 0'),
    body('notes').optional().isString(),
    validate,
  ],
  ctrl.createMovement
);

// ── Materiales ────────────────────────────────────────────────────────────────
router.get('/', ctrl.listStock);
router.get('/:id', [param('id').isInt({ min: 1 }), validate], ctrl.getStock);

router.post(
  '/',
  authorize('admin', 'billing'),
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('unit').isIn(['unidad', 'metro', 'kg', 'litro']).withMessage('Unidad inválida'),
    body('category_id').optional().isInt({ min: 1 }),
    body('current_quantity').optional().isFloat({ min: 0 }),
    body('min_quantity').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.createStock
);

router.put(
  '/:id',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('unit').optional().isIn(['unidad', 'metro', 'kg', 'litro']),
    body('min_quantity').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.updateStock
);

router.delete(
  '/:id',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteStock
);

export default router;
