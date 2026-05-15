import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/user.controller';

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', ctrl.listUsers);

router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('email').isEmail().withMessage('Email inválido'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('La contraseña debe tener al menos 8 caracteres'),
    body('role').isIn(['admin', 'billing', 'workshop']).withMessage('Rol inválido'),
    validate,
  ],
  ctrl.createUser
);

router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body('email').optional().isEmail(),
    body('role').optional().isIn(['admin', 'billing', 'workshop']),
    validate,
  ],
  ctrl.updateUser
);

router.delete(
  '/:id',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteUser
);

export default router;
