import { Router } from 'express';
import { body } from 'express-validator';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { authLimiter, passwordResetLimiter } from '../middlewares/rateLimit';
import { EMAIL_NORMALIZE_OPTS } from '../utils/emailNormalize';

// Mínimo 10 caracteres, máximo 128 (S-02 de la auditoría del 2026-08-19).
//
// El tope anterior era 10, contra 100 de los compradores de la tienda
// (store.routes.ts): el administrador que mueve la caja no podía usar una
// passphrase y el comprador sí. No había razón técnica — bcrypt corta a 72
// bytes de todas formas.
//
// El login NO revalida contra este regex, así que las contraseñas existentes de
// 6 a 10 caracteres siguen funcionando; el mínimo nuevo se exige sólo al crear
// o cambiar una. Forzar la rotación de las actuales se evaluó y se descartó
// (expulsaría a todos los usuarios); ver 08-DECISIONS.md.
const PWD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]])[A-Za-z\d@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]]{10,128}$/;
const PWD_MSG   = 'La contraseña debe tener entre 10 y 128 caracteres, incluir letras, números y al menos un carácter especial (@ $ ! % * # ? & . _ - + / etc.)';

const router = Router();

router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .trim()
      .isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS),
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
    body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail(EMAIL_NORMALIZE_OPTS),
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
