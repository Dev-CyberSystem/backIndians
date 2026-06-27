import { Router } from 'express';
import { body } from 'express-validator';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { authLimiter, passwordResetLimiter } from '../middlewares/rateLimit';

const PWD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]])[A-Za-z\d@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]]{6,10}$/;
const PWD_MSG   = 'La contraseña debe tener entre 6 y 10 caracteres, incluir letras, números y al menos un carácter especial (@ $ ! % * # ? & . _ - + / etc.)';

const router = Router();

router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .trim()
      .isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Contraseña requerida'),
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
  passwordResetLimiter,
  [
    body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail(),
    validate,
  ],
  forgotPassword
);

router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').notEmpty().withMessage('Token requerido'),
    body('newPassword')
      .matches(PWD_REGEX).withMessage(PWD_MSG),
    validate,
  ],
  resetPassword
);

export default router;
