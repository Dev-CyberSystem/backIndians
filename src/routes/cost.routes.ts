import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/cost.controller';

const router = Router();

// Costos: sensibles. Solo Administración y Facturación (lectura y escritura).
router.use(authenticate);
router.use(authorize('admin', 'billing'));

// ── Maestro de ítems por categoría ──
router.get(
  '/items',
  [query('category').isIn(['jersey', 'shorts']).withMessage('Categoría inválida'), validate],
  ctrl.listCostItems
);

// ── Preview en vivo del costo de un pedido (ruta estática antes de las params) ──
router.post(
  '/preview',
  [
    body('client_id').isInt({ min: 1 }).withMessage('client_id requerido'),
    body('items').isArray().withMessage('items debe ser un array'),
    body('items.*.garment_type_id').isInt({ min: 1 }),
    body('items.*.quantity').optional().isInt({ min: 0 }),
    validate,
  ],
  ctrl.previewOrderCosts
);

// ── Detalle congelado de un pedido ──
router.get(
  '/orders/:orderId',
  [param('orderId').isInt({ min: 1 }), validate],
  ctrl.getOrderCostDetails
);

// ── Prendas con costo de un cliente ──
router.get(
  '/clients/:clientId',
  [param('clientId').isInt({ min: 1 }), validate],
  ctrl.listClientCostSheets
);

// ── Hoja de costos de una prenda (cliente + tipo de prenda) ──
router.get(
  '/clients/:clientId/garments/:garmentTypeId',
  [param('clientId').isInt({ min: 1 }), param('garmentTypeId').isInt({ min: 1 }), validate],
  ctrl.getCostSheet
);

router.put(
  '/clients/:clientId/garments/:garmentTypeId',
  [
    param('clientId').isInt({ min: 1 }),
    param('garmentTypeId').isInt({ min: 1 }),
    body('items').isArray().withMessage('items debe ser un array'),
    body('items.*.amount').isFloat({ min: 0 }).withMessage('Monto inválido'),
    body('items.*.key').optional().isString(),
    body('items.*.cost_item_id').optional().isInt({ min: 1 }),
    validate,
  ],
  ctrl.saveCostSheet
);

// ── Historial de una prenda ──
router.get(
  '/clients/:clientId/garments/:garmentTypeId/history',
  [param('clientId').isInt({ min: 1 }), param('garmentTypeId').isInt({ min: 1 }), validate],
  ctrl.getCostHistory
);

export default router;
