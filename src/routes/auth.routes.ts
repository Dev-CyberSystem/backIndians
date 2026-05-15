import { Router } from 'express';
import { body } from 'express-validator';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
    validate,
  ],
  login
);

router.post(
  '/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token requerido'),
    validate,
  ],
  refresh
);

router.post('/logout', authenticate, logout);

router.get('/me', authenticate, me);

router.post(
  '/forgot-password',
  [
    body('email').isEmail().withMessage('Email inválido'),
    validate,
  ],
  forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token requerido'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('La contraseña debe tener al menos 8 caracteres'),
    validate,
  ],
  resetPassword
);

export default router;
