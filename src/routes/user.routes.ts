import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/user.controller';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

const PWD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]])[A-Za-z\d@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]]{6,10}$/;
const PWD_MSG   = 'La contraseña debe tener entre 6 y 10 caracteres, incluir letras, números y al menos un carácter especial (@ $ ! % * # ? & . _ - + / etc.)';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', ctrl.listUsers);

router.post(
  '/',
  [
    body('name')
      .trim().notEmpty().withMessage('Nombre requerido')
      .isLength({ max: 150 }).withMessage('El nombre no puede superar los 150 caracteres'),
    body('email')
      .trim().isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS)
      .isLength({ max: 255 }).withMessage('Email demasiado largo'),
    body('password')
      .matches(PWD_REGEX).withMessage(PWD_MSG),
    body('role')
      .isIn(['admin', 'billing', 'workshop', 'seller']).withMessage('Rol inválido'),
    validate,
  ],
  ctrl.createUser
);

router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('name')
      .optional().trim().notEmpty().withMessage('Nombre requerido')
      .isLength({ max: 150 }).withMessage('El nombre no puede superar los 150 caracteres'),
    body('email')
      .optional().trim().isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS),
    body('role')
      .optional().isIn(['admin', 'billing', 'workshop', 'seller']).withMessage('Rol inválido'),
    validate,
  ],
  ctrl.updateUser
);

router.patch(
  '/:id/toggle',
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.toggleUser
);

router.post(
  '/:id/resend-welcome',
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.resendWelcome
);

router.patch(
  '/:id/password',
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('password').matches(PWD_REGEX).withMessage(PWD_MSG),
    validate,
  ],
  ctrl.changeUserPassword
);

router.delete(
  '/:id',
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), validate],
  ctrl.deleteUser
);

export default router;
