import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/master.controller';

const router = Router();

// Todos los roles autenticados pueden leer las tablas maestras
router.use(authenticate);

// ─── Tipos de prenda ──────────────────────────────────────────────────────────
router.get('/garment-types', ctrl.listGarmentTypes);

router.post(
  '/garment-types',
  authorize('admin'),
  [body('name').notEmpty().withMessage('Nombre requerido'), validate],
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
