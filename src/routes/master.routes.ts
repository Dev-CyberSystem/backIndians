import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/master.controller';

const router = Router();

// Todos los roles autenticados pueden leer las tablas maestras
router.use(authenticate);

// ─── Tipos de prenda ──────────────────────────────────────────────────────────
// ?client_id=X filtra las prendas del cliente (los globales/legado quedan fuera).
router.get(
  '/garment-types',
  [query('client_id').optional().isInt({ min: 1 }), validate],
  ctrl.listGarmentTypes
);

router.post(
  '/garment-types',
  authorize('admin'),
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('client_id').optional({ nullable: true }).isInt({ min: 1 }),
    validate,
  ],
  ctrl.createGarmentType
);

router.put(
  '/garment-types/:id',
  authorize('admin'),
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().notEmpty(),
    body('active').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
    validate,
  ],
  ctrl.updateGarmentType
);

// Categoría de costo — admin y billing (necesaria para cargar costos)
router.put(
  '/garment-types/:id/cost-category',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('cost_category').custom((v) => v === null || v === 'jersey' || v === 'shorts')
      .withMessage('Categoría inválida'),
    validate,
  ],
  ctrl.setGarmentCostCategory
);

// ─── Tipos de tela ────────────────────────────────────────────────────────────
router.get('/fabric-types', ctrl.listFabricTypes);

router.post(
  '/fabric-types',
  authorize('admin'),
  [body('name').notEmpty().withMessage('Nombre requerido'), validate],
  ctrl.createFabricType
);

router.put(
  '/fabric-types/:id',
  authorize('admin'),
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().notEmpty(),
    body('active').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
    validate,
  ],
  ctrl.updateFabricType
);

// ─── Tallas ───────────────────────────────────────────────────────────────────
router.get('/sizes', ctrl.listSizes);

router.post(
  '/sizes',
  authorize('admin'),
  [body('name').notEmpty().withMessage('Nombre requerido'), validate],
  ctrl.createSize
);

router.put(
  '/sizes/:id',
  authorize('admin'),
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().notEmpty(),
    body('active').optional().isBoolean(),
    body('sort_order').optional().isInt({ min: 0 }),
    validate,
  ],
  ctrl.updateSize
);

export default router;
