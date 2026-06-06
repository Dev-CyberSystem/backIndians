import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/settings.controller';

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
      .isEmail().withMessage('Email de empresa inválido').normalizeEmail(),
    body('invoice_due_days')
      .optional()
      .isInt({ min: 0, max: 365 }).withMessage('Los días de vencimiento deben ser entre 0 y 365'),
    validate,
  ],
  ctrl.updateSettings
);

export default router;
