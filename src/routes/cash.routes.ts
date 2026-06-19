import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/cash.controller';

const router = Router();

router.use(authenticate);
router.use(authorize('admin', 'billing'));

// ── Resumen (ruta estática antes de /:id) ─────────────────────────────────────
router.get('/summary', ctrl.getSummary);

// ── Cuentas ───────────────────────────────────────────────────────────────────
router.get('/accounts', ctrl.listAccounts);

router.post(
  '/accounts',
  [
    body('name').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 150 }),
    body('type').isIn(['cash', 'petty_cash', 'bank']).withMessage('Tipo inválido'),
    body('description').optional().isString(),
    validate,
  ],
  ctrl.createAccount
);

router.put(
  '/accounts/:id',
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('type').optional().isIn(['cash', 'petty_cash', 'bank']),
    body('description').optional().isString(),
    validate,
  ],
  ctrl.updateAccount
);

router.patch(
  '/accounts/:id/toggle',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.toggleAccount
);

// ── Categorías ────────────────────────────────────────────────────────────────
router.get('/categories', ctrl.listCategories);

router.post(
  '/categories',
  [
    body('name').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 150 }),
    body('type').isIn(['income', 'expense', 'both']).withMessage('Tipo inválido'),
    body('color').optional().isString().isLength({ max: 10 }),
    validate,
  ],
  ctrl.createCategory
);

router.put(
  '/categories/:id',
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }),
    body('type').optional().isIn(['income', 'expense', 'both']),
    body('color').optional().isString().isLength({ max: 10 }),
    validate,
  ],
  ctrl.updateCategory
);

router.patch(
  '/categories/:id/toggle',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.toggleCategory
);

// ── Transacciones ─────────────────────────────────────────────────────────────
router.get(
  '/transactions',
  [
    query('account_id').optional().isInt({ min: 1 }),
    query('category_id').optional().isInt({ min: 1 }),
    query('type').optional().isIn(['income', 'expense', 'transfer']),
    query('date_from').optional().isDate({ format: 'YYYY-MM-DD' }),
    query('date_to').optional().isDate({ format: 'YYYY-MM-DD' }),
    query('reference_type').optional().isIn(['invoice', 'order']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate,
  ],
  ctrl.listTransactions
);

router.get(
  '/transactions/:id',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getTransaction
);

router.post(
  '/transactions',
  [
    body('account_id').isInt({ min: 1 }).withMessage('Cuenta requerida'),
    body('category_id').isInt({ min: 1 }).withMessage('Categoría requerida'),
    body('type').isIn(['income', 'expense', 'transfer']).withMessage('Tipo inválido'),
    body('amount')
      .isDecimal({ decimal_digits: '0,2' })
      .toFloat()
      .custom((v) => v > 0)
      .withMessage('Monto debe ser mayor a 0'),
    body('description').trim().isLength({ min: 1, max: 255 }).withMessage('Descripción requerida'),
    body('date').isDate({ format: 'YYYY-MM-DD' }).withMessage('Fecha inválida'),
    body('transfer_account_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('reference_type').optional({ nullable: true }).isIn(['invoice', 'order']),
    body('reference_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('notes').optional({ nullable: true }).isString(),
    validate,
  ],
  ctrl.createTransaction
);

router.put(
  '/transactions/:id',
  [
    param('id').isInt({ min: 1 }),
    body('account_id').optional().isInt({ min: 1 }),
    body('category_id').optional().isInt({ min: 1 }),
    body('type').optional().isIn(['income', 'expense', 'transfer']),
    body('amount')
      .optional()
      .isDecimal({ decimal_digits: '0,2' })
      .toFloat()
      .custom((v) => v > 0)
      .withMessage('Monto debe ser mayor a 0'),
    body('description').optional().trim().isLength({ min: 1, max: 255 }),
    body('date').optional().isDate({ format: 'YYYY-MM-DD' }),
    body('transfer_account_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('reference_type').optional({ nullable: true }).isIn(['invoice', 'order']),
    body('reference_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('notes').optional({ nullable: true }).isString(),
    validate,
  ],
  ctrl.updateTransaction
);

router.delete(
  '/transactions/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteTransaction
);

export default router;
