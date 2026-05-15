import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { upload } from '../middlewares/upload';
import * as ctrl from '../controllers/order.controller';

const router = Router();

router.use(authenticate);

// GET /orders — admin y billing ven todo, workshop solo sus estados, seller solo los suyos
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'pending', 'under_review', 'workshop_review', 'observed',
      'in_production', 'quality_check', 'ready', 'cancelled',
    ]),
    query('client_id').optional().isInt({ min: 1 }),
    query('seller_id').optional().isInt({ min: 1 }),
    query('order_number').optional().isString(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('delivery_date_from').optional().isISO8601(),
    query('delivery_date_to').optional().isISO8601(),
    validate,
  ],
  ctrl.listOrders
);

// GET /orders/:id — seller solo ve los suyos (validado en service)
router.get(
  '/:id',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getOrder
);

// POST /orders — billing, admin y seller
router.post(
  '/',
  authorize('admin', 'billing', 'seller'),
  [
    body('client_id').isInt({ min: 1 }).withMessage('client_id requerido'),
    body('delivery_date').optional().isISO8601(),
    body('notes').optional().isString(),
    body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un ítem'),
    // Campos obligatorios del ítem
    body('items.*.garment_type_id').isInt({ min: 1 }).withMessage('garment_type_id requerido'),
    body('items.*.fabric_type_id').isInt({ min: 1 }).withMessage('fabric_type_id requerido'),
    body('items.*.color').notEmpty().withMessage('color requerido'),
    body('items.*.sizes').isObject().withMessage('sizes debe ser un objeto'),
    // Diseño — opcionales
    body('items.*.color_secondary').optional().isString(),
    body('items.*.color_sleeves').optional().isString(),
    body('items.*.color_collar').optional().isString(),
    body('items.*.color_seam_tape').optional().isString(),
    body('items.*.collar_type').optional().isIn(['v', 'round', 'mao']),
    body('items.*.sleeve_type').optional().isIn(['raglan', 'classic']),
    // Accesorios
    body('items.*.short_description').optional().isString(),
    body('items.*.socks_description').optional().isString(),
    // Materiales
    body('items.*.logo_material').optional().isString(),
    body('items.*.size_label_type').optional().isString(),
    body('items.*.composition_label').optional().isString(),
    // Tela
    body('items.*.fabric_composition').optional().isString(),
    body('items.*.fabric_weight').optional().isString(),
    // Sponsors y personalización
    body('items.*.sponsors').optional().isArray(),
    body('items.*.sponsors.*.element').optional().isString(),
    body('items.*.sponsors.*.location').optional().isString(),
    body('items.*.customization').optional().isObject(),
    // Bordado
    body('items.*.has_embroidery').optional().isBoolean(),
    body('items.*.embroidery_notes').optional().isString(),
    // Precio y notas
    body('items.*.unit_price').optional().isFloat({ min: 0 }),
    body('items.*.notes').optional().isString(),
    validate,
  ],
  ctrl.createOrder
);

// PUT /orders/:id — todos los roles autenticados (validación de permisos en el service)
router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body('client_id').optional().isInt({ min: 1 }),
    body('delivery_date').optional().isISO8601(),
    body('notes').optional().isString(),
    body('workshop_notes').optional().isString(),
    body('status').optional().isIn([
      'pending', 'under_review', 'workshop_review', 'observed',
      'in_production', 'quality_check', 'ready', 'cancelled',
    ]),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.garment_type_id').optional().isInt({ min: 1 }),
    body('items.*.fabric_type_id').optional().isInt({ min: 1 }),
    body('items.*.color').optional().notEmpty(),
    body('items.*.sizes').optional().isObject(),
    body('items.*.color_secondary').optional().isString(),
    body('items.*.color_sleeves').optional().isString(),
    body('items.*.color_collar').optional().isString(),
    body('items.*.color_seam_tape').optional().isString(),
    body('items.*.collar_type').optional().isIn(['v', 'round', 'mao']),
    body('items.*.sleeve_type').optional().isIn(['raglan', 'classic']),
    body('items.*.short_description').optional().isString(),
    body('items.*.socks_description').optional().isString(),
    body('items.*.logo_material').optional().isString(),
    body('items.*.size_label_type').optional().isString(),
    body('items.*.composition_label').optional().isString(),
    body('items.*.fabric_composition').optional().isString(),
    body('items.*.fabric_weight').optional().isString(),
    body('items.*.sponsors').optional().isArray(),
    body('items.*.customization').optional().isObject(),
    body('items.*.has_embroidery').optional().isBoolean(),
    body('items.*.embroidery_notes').optional().isString(),
    body('items.*.unit_price').optional().isFloat({ min: 0 }),
    body('items.*.notes').optional().isString(),
    validate,
  ],
  ctrl.updateOrder
);

// DELETE /orders/:id — solo admin
router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteOrder
);

// POST /orders/:id/images — billing y admin
router.post(
  '/:id/images',
  authorize('admin', 'billing'),
  upload.single('image'),
  ctrl.uploadImage
);

// DELETE /orders/:id/images/:imgId — billing y admin
router.delete(
  '/:id/images/:imgId',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    param('imgId').isInt({ min: 1 }),
    validate,
  ],
  ctrl.deleteImage
);

// GET /orders/:id/pdf — todos los roles
router.get(
  '/:id/pdf',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getOrderPDF
);

// GET /orders/:id/history — todos los roles
router.get(
  '/:id/history',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getOrderHistory
);

export default router;
