import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/employee.controller';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

const PHONE_REGEX = /^[+\d\s\-()\/.]{6,30}$/;
const DNI_REGEX = /^[\d.]{7,12}$/; // dígitos con puntos opcionales; el service normaliza
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPES = [
  'salary_change', 'sanction', 'notification', 'sick_leave',
  'leave', 'onboarding', 'offboarding', 'other',
];

const employeeFields = [
  body('full_name')
    .trim().notEmpty().withMessage('El nombre completo es obligatorio')
    .isLength({ max: 200 }).withMessage('Máximo 200 caracteres'),
  body('dni').trim().matches(DNI_REGEX).withMessage('DNI inválido (7 a 9 dígitos)'),
  body('address').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('email')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS)
    .isLength({ max: 150 }),
  body('phone')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .matches(PHONE_REGEX).withMessage('Teléfono inválido'),
  body('hire_date').trim().matches(DATE_REGEX).withMessage('Fecha de ingreso inválida (AAAA-MM-DD)'),
  body('termination_date')
    .optional({ nullable: true, checkFalsy: true }).trim()
    .matches(DATE_REGEX).withMessage('Fecha de egreso inválida (AAAA-MM-DD)'),
  body('current_remuneration')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0 }).withMessage('Remuneración inválida'),
  body('sector').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('notes').optional({ nullable: true }).trim().isLength({ max: 4000 }),
];

const router = Router();
router.use(authenticate);
// Legajo de empleados y remuneraciones: dato de nómina, solo administración.
router.use(authorize('admin'));

router.get(
  '/',
  [
    query('search').optional().isString(),
    query('sector').optional().isString(),
    query('include_inactive').optional().isIn(['true', 'false']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    validate,
  ],
  ctrl.list
);

router.get('/sectors', ctrl.sectors);

router.get('/:id', [param('id').isInt({ min: 1 }), validate], ctrl.getOne);

router.post('/', [...employeeFields, validate], ctrl.create);

router.put(
  '/:id',
  [param('id').isInt({ min: 1 }), ...employeeFields.map((v) => v.optional({ nullable: true })), validate],
  ctrl.update
);

router.patch(
  '/:id/status',
  [
    param('id').isInt({ min: 1 }),
    body('active').isBoolean(),
    body('termination_date').optional({ nullable: true, checkFalsy: true }).matches(DATE_REGEX),
    validate,
  ],
  ctrl.setStatus
);

router.delete('/:id', [param('id').isInt({ min: 1 }), validate], ctrl.remove);

// ─── Novedades del legajo ──────────────────────────────────────────────────

router.get('/:id/events', [param('id').isInt({ min: 1 }), validate], ctrl.listEvents);

router.post(
  '/:id/events',
  [
    param('id').isInt({ min: 1 }),
    body('type').isIn(EVENT_TYPES).withMessage('Tipo de novedad inválido'),
    body('title').trim().notEmpty().withMessage('El título es obligatorio').isLength({ max: 200 }),
    body('body').optional({ nullable: true }).trim().isLength({ max: 4000 }),
    body('event_date').optional({ nullable: true, checkFalsy: true }).matches(DATE_REGEX),
    body('amount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
    validate,
  ],
  ctrl.addEvent
);

router.delete(
  '/:id/events/:eventId',
  [param('id').isInt({ min: 1 }), param('eventId').isInt({ min: 1 }), validate],
  ctrl.removeEvent
);

export default router;
