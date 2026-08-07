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

// ── Auditoría (solo admin; solo lectura — la tabla es append-only) ────────────
router.get(
  '/audit',
  authorize('admin'),
  [
    query('entity_type').optional().isIn(['transaction', 'account', 'category']),
    query('entity_id').optional().isInt({ min: 1 }),
    query('action').optional().isIn(['create', 'update', 'reverse', 'delete', 'toggle']),
    query('user_id').optional().isInt({ min: 1 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate,
  ],
  ctrl.listAuditEvents
);

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
    query('status').optional().isIn(['active', 'reversed']),
    query('date_from').optional().isDate({ format: 'YYYY-MM-DD' }),
    query('date_to').optional().isDate({ format: 'YYYY-MM-DD' }),
    // Incluye 'store_order': hallazgo CASH-FILTER-001 de la auditoría — el
    // validador no dejaba filtrar por el propio valor que usa la integración
    // automática de tienda.
    query('reference_type').optional().isIn(['invoice', 'order', 'store_order']),
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
    body('idempotency_key').optional({ nullable: true }).isString().isLength({ max: 80 }),
    validate,
  ],
  ctrl.createTransaction
);

// Edición limitada a campos no financieros — ver PatchTransactionInput en el
// servicio para por qué nunca se acepta amount/type/account_id/date acá.
router.patch(
  '/transactions/:id',
  [
    param('id').isInt({ min: 1 }),
    body('description').optional().trim().isLength({ min: 1, max: 255 }),
    body('notes').optional({ nullable: true }).isString(),
    body('category_id').optional().isInt({ min: 1 }),
    validate,
  ],
  ctrl.patchTransaction
);

// Único camino para corregir un importe: crea un contraasiento, nunca toca
// el original (hallazgo CASH-MUT-001 de la auditoría — PUT/DELETE quedaron
// eliminados a propósito, no es un descuido). Solo admin (Fase 5 del plan de
// corrección, decisión confirmada con el usuario): billing sigue pudiendo
// crear movimientos y corregir campos no financieros vía PATCH, pero
// revertir un movimiento confirmado queda reservado a admin.
router.post(
  '/transactions/:id/reverse',
  authorize('admin'),
  [
    param('id').isInt({ min: 1 }),
    body('reason').trim().isLength({ min: 10, max: 500 }).withMessage('El motivo debe tener al menos 10 caracteres'),
    body('amount')
      .optional()
      .isDecimal({ decimal_digits: '0,2' })
      .toFloat()
      .custom((v) => v > 0)
      .withMessage('Si se especifica, el monto a revertir debe ser mayor a 0'),
    validate,
  ],
  ctrl.reverseTransaction
);

export default router;
