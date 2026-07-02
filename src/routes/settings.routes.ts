import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/settings.controller';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

const router = Router();
router.use(authenticate, authorize('admin', 'billing'));

router.get('/', ctrl.getSettings);

router.put(
  '/',
  [
    body('company_name')
      .optional().trim()
      .isLength({ max: 200 }).withMessage('Razón social demasiado larga (máx. 200 caracteres)'),
    body('company_cuit')
      .optional().trim()
      .matches(/^\d{2}-\d{8}-\d$/).withMessage('CUIT inválido (formato: XX-XXXXXXXX-X)'),
    body('company_address')
      .optional().trim()
      .isLength({ max: 300 }).withMessage('Dirección demasiado larga (máx. 300 caracteres)'),
    body('company_phone')
      .optional().trim()
      .matches(/^[+\d\s\-()\/.]{0,30}$/).withMessage('Teléfono inválido'),
    body('company_email')
      .optional().trim()
      .isEmail().withMessage('Email de empresa inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS),
    body('company_website')
      .optional({ checkFalsy: true }).trim()
      .isLength({ max: 200 }).withMessage('Sitio web demasiado largo (máx. 200 caracteres)'),
    body('company_iva_condition')
      .optional().trim()
      .isLength({ max: 100 }).withMessage('Condición IVA demasiado larga (máx. 100 caracteres)'),
    body('company_activity_start')
      .optional().trim()
      .isLength({ max: 40 }).withMessage('Fecha de inicio de actividades inválida'),
    body('invoice_due_days')
      .optional()
      .isInt({ min: 0, max: 365 }).withMessage('Los días de vencimiento deben ser entre 0 y 365'),
    body('invoice_point_of_sale')
      .optional({ checkFalsy: true }).trim()
      .matches(/^\d{1,4}$/).withMessage('Punto de venta inválido (1 a 4 dígitos)'),
    body('invoice_default_type')
      .optional().trim()
      .matches(/^[ABCEMX]$/i).withMessage('Tipo de comprobante inválido (A, B, C, E, M o X)'),
    validate,
  ],
  ctrl.updateSettings
);

export default router;
