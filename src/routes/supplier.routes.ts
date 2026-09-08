import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/supplier.controller';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

const PHONE_REGEX = /^[+\d\s\-()\/.]{6,30}$/;
const TAX_CONDITIONS = [
  'responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_categorizado',
];

// Acepta el CUIT con o sin guiones; el servicio lo normaliza a 11 dígitos.
const CUIT_LOOSE_REGEX = /^\d{2}-?\d{8}-?\d$/;

const supplierFields = [
  body('business_name')
    .trim().notEmpty().withMessage('La razón social es obligatoria')
    .isLength({ max: 200 }).withMessage('Máximo 200 caracteres'),
  body('trade_name').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('category').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('tax_id')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .matches(CUIT_LOOSE_REGEX).withMessage('CUIT inválido (formato: XX-XXXXXXXX-X)'),
  body('tax_condition').optional({ nullable: true, checkFalsy: true }).isIn(TAX_CONDITIONS),
  body('address').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('province').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('locality').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('postal_code').optional({ nullable: true }).trim().isLength({ max: 20 }),
  body('phone')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .matches(PHONE_REGEX).withMessage('Teléfono inválido'),
  body('whatsapp')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .matches(PHONE_REGEX).withMessage('WhatsApp inválido'),
  body('email')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS)
    .isLength({ max: 150 }).withMessage('Email demasiado largo'),
  body('contact_person').optional({ nullable: true }).trim().isLength({ max: 150 }),
  body('payment_terms').optional({ nullable: true }).trim().isLength({ max: 150 }),
  body('notes').optional({ nullable: true }).trim().isLength({ max: 2000 }),
];

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('admin', 'billing'),
  [
    query('search').optional().isString(),
    query('category').optional().isString(),
    query('include_inactive').optional().isIn(['true', 'false']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    validate,
  ],
  ctrl.list
);

router.get('/categories', authorize('admin', 'billing'), ctrl.categories);

router.get(
  '/:id',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.getOne
);

router.post(
  '/',
  authorize('admin', 'billing'),
  [...supplierFields, validate],
  ctrl.create
);

router.put(
  '/:id',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    ...supplierFields.map((v) => v.optional({ nullable: true })),
    validate,
  ],
  ctrl.update
);

router.patch(
  '/:id/status',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), body('active').isBoolean(), validate],
  ctrl.setStatus
);

router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.remove
);

export default router;
