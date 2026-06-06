import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/client.controller';

const CUIT_REGEX  = /^\d{2}-\d{8}-\d$/;
const PHONE_REGEX = /^[+\d\s\-()\/.]{6,30}$/;

const clientFields = [
  body('name')
    .trim().notEmpty().withMessage('Nombre requerido')
    .isLength({ max: 200 }).withMessage('Nombre demasiado largo (máx. 200 caracteres)'),
  body('contact_name')
    .optional({ nullable: true }).trim()
    .isLength({ max: 150 }).withMessage('Nombre de contacto demasiado largo (máx. 150 caracteres)'),
  body('phone')
    .optional({ nullable: true }).trim()
    .matches(PHONE_REGEX).withMessage('Teléfono inválido (ej: +54 351 000-0000)'),
  body('email')
    .optional({ nullable: true }).trim()
    .isEmail().withMessage('Email inválido').normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email demasiado largo'),
  body('address')
    .optional({ nullable: true }).trim()
    .isLength({ max: 500 }).withMessage('Dirección demasiado larga (máx. 500 caracteres)'),
  body('cuit')
    .optional({ nullable: true }).trim()
    .matches(CUIT_REGEX).withMessage('CUIT inválido (formato: XX-XXXXXXXX-X)'),
  body('notes')
    .optional({ nullable: true }).trim()
    .isLength({ max: 1000 }).withMessage('Notas demasiado largas (máx. 1000 caracteres)'),
];

const router = Router();
router.use(authenticate);

router.get('/', authorize('admin', 'billing', 'seller'), ctrl.listClients);

router.post(
  '/',
  authorize('admin', 'billing', 'seller'),
  [...clientFields, validate],
  ctrl.createClient
);

router.put(
  '/:id',
  authorize('admin', 'billing', 'seller'),
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    ...clientFields.map((v) => v.optional()),
    validate,
  ],
  ctrl.updateClient
);

router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.deleteClient
);

export default router;
