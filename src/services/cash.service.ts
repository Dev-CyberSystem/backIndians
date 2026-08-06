import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../config/db';
import {
  CashAccount, CashTransactionCategory, CashTransaction, User,
} from '../models';
import { AppError } from '../middlewares/errorHandler';
import { CashAuditContext, recordCashAudit, snapshotOf } from './cashAudit.service';

type SummaryResult = {
  accounts: { id: number; name: string; type: 'cash' | 'petty_cash' | 'bank'; current_balance: number }[];
  total_income: number;
  total_expense: number;
  net_balance: number;
  by_category: { category_id: number; name: string; type: string; color: string | null; total: number }[];
  daily_evolution: { date: string; income: number; expense: number; net: number }[];
  period_label: string;
};

// ── Helpers de período ────────────────────────────────────────────────────────

function parsePeriod(period = 'last6'): { dateFrom: string; dateTo: string; periodLabel: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateTo = fmt(now);

  if (period === 'last30') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { dateFrom: fmt(from), dateTo, periodLabel: 'Últimos 30 días' };
  }

  if (period === 'last6') {
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { dateFrom: fmt(from), dateTo, periodLabel: 'Últimos 6 meses' };
  }

  // YYYY
  if (/^\d{4}$/.test(period)) {
    return {
      dateFrom: `${period}-01-01`,
      dateTo: `${period}-12-31`,
      periodLabel: `Año ${period}`,
    };
  }

  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const raw = new Date(y, m - 1, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return {
      dateFrom: `${period}-01`,
      dateTo: `${period}-${pad(lastDay)}`,
      periodLabel: label,
    };
  }

  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return { dateFrom: fmt(from), dateTo, periodLabel: 'Últimos 6 meses' };
}

// ── Cuentas ───────────────────────────────────────────────────────────────────

export async function listAccounts() {
  return CashAccount.findAll({
    order: [['name', 'ASC']],
  });
}

export async function createAccount(
  input: {
    name: string;
    type: 'cash' | 'petty_cash' | 'bank';
    description?: string;
  },
  ctx: CashAuditContext
) {
  return sequelize.transaction(async (t) => {
    const acc = await CashAccount.create(
      {
        name: input.name,
        type: input.type,
        description: input.description || null,
        current_balance: 0,
        active: true,
      },
      { transaction: t }
    );

    await recordCashAudit(
      { entityType: 'account', entityId: acc.id, action: 'create', after: snapshotOf(acc), context: ctx },
      t
    );
    return acc;
  });
}

export async function updateAccount(
  id: number,
  input: {
    name?: string;
    type?: 'cash' | 'petty_cash' | 'bank';
    description?: string;
  },
  ctx: CashAuditContext
) {
  const acc = await CashAccount.findByPk(id);
  if (!acc) throw new AppError('Cuenta no encontrada', 404);
  const before = snapshotOf(acc);

  await sequelize.transaction(async (t) => {
    await acc.update(input, { transaction: t });
    await recordCashAudit(
      { entityType: 'account', entityId: acc.id, action: 'update', before, after: snapshotOf(acc), context: ctx },
      t
    );
  });
  return acc;
}

export async function toggleAccount(id: number, ctx: CashAuditContext) {
  const acc = await CashAccount.findByPk(id);
  if (!acc) throw new AppError('Cuenta no encontrada', 404);
  const before = snapshotOf(acc);

  await sequelize.transaction(async (t) => {
    await acc.update({ active: !acc.active }, { transaction: t });
    await recordCashAudit(
      { entityType: 'account', entityId: acc.id, action: 'toggle', before, after: snapshotOf(acc), context: ctx },
      t
    );
  });
  return acc;
}

// ── Categorías ────────────────────────────────────────────────────────────────

export async function listCategories() {
  return CashTransactionCategory.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  });
}

export async function createCategory(
  input: {
    name: string;
    type: 'income' | 'expense' | 'both';
    color?: string;
  },
  ctx: CashAuditContext
) {
  return sequelize.transaction(async (t) => {
    const cat = await CashTransactionCategory.create(
      {
        name: input.name,
        type: input.type,
        color: input.color || null,
        is_system: false,
        active: true,
      },
      { transaction: t }
    );

    await recordCashAudit(
      { entityType: 'category', entityId: cat.id, action: 'create', after: snapshotOf(cat), context: ctx },
      t
    );
    return cat;
  });
}

export async function updateCategory(
  id: number,
  input: {
    name?: string;
    type?: 'income' | 'expense' | 'both';
    color?: string;
  },
  ctx: CashAuditContext
) {
  const cat = await CashTransactionCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  if (cat.is_system) throw new AppError('No se pueden editar categorías del sistema', 403);
  const before = snapshotOf(cat);

  await sequelize.transaction(async (t) => {
    await cat.update(input, { transaction: t });
    await recordCashAudit(
      { entityType: 'category', entityId: cat.id, action: 'update', before, after: snapshotOf(cat), context: ctx },
      t
    );
  });
  return cat;
}

export async function toggleCategory(id: number, ctx: CashAuditContext) {
  const cat = await CashTransactionCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  if (cat.is_system) throw new AppError('No se pueden desactivar categorías del sistema', 403);
  const before = snapshotOf(cat);

  await sequelize.transaction(async (t) => {
    await cat.update({ active: !cat.active }, { transaction: t });
    await recordCashAudit(
      { entityType: 'category', entityId: cat.id, action: 'toggle', before, after: snapshotOf(cat), context: ctx },
      t
    );
  });
  return cat;
}

// ── Transacciones ─────────────────────────────────────────────────────────────

const TX_INCLUDES = [
  { model: CashAccount, as: 'account', attributes: ['id', 'name', 'type'] },
  { model: CashAccount, as: 'transfer_account', attributes: ['id', 'name', 'type'] },
  { model: CashTransactionCategory, as: 'category', attributes: ['id', 'name', 'type', 'color'] },
  { model: User, as: 'creator', attributes: ['id', 'name', 'role'] },
  { model: CashTransaction, as: 'reversal_of', attributes: ['id', 'description', 'amount', 'type'] },
  { model: CashTransaction, as: 'reversals', attributes: ['id', 'description', 'amount', 'type', 'createdAt'] },
  { model: User, as: 'reverser', attributes: ['id', 'name'] },
];

export interface ListTransactionsOptions {
  account_id?: number;
  category_id?: number;
  type?: 'income' | 'expense' | 'transfer';
  status?: 'active' | 'reversed';
  date_from?: string;
  date_to?: string;
  reference_type?: 'invoice' | 'order' | 'store_order';
  page: number;
  limit: number;
}

export async function listTransactions(options: ListTransactionsOptions) {
  const { page, limit } = options;
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (options.account_id)      where.account_id   = options.account_id;
  if (options.category_id)     where.category_id  = options.category_id;
  if (options.type)            where.type         = options.type;
  if (options.status)          where.status       = options.status; // sin filtro: se ven activas y revertidas
  if (options.reference_type)  where.reference_type = options.reference_type;

  if (options.date_from || options.date_to) {
    where.date = {
      ...(options.date_from && { [Op.gte]: options.date_from }),
      ...(options.date_to   && { [Op.lte]: options.date_to }),
    };
  }

  const { rows, count } = await CashTransaction.findAndCountAll({
    where,
    include: TX_INCLUDES,
    order: [['date', 'DESC'], ['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { transactions: rows, total: count, page, limit };
}

export async function getTransaction(id: number) {
  const tx = await CashTransaction.findByPk(id, { include: TX_INCLUDES });
  if (!tx) throw new AppError('Transacción no encontrada', 404);
  return tx;
}

// Aplica el efecto de una transacción sobre los saldos dentro de una DB transaction
async function applyBalanceEffect(
  type: 'income' | 'expense' | 'transfer',
  amount: number,
  accountId: number,
  transferAccountId: number | null | undefined,
  t: import('sequelize').Transaction
) {
  if (type === 'income') {
    await CashAccount.increment('current_balance', { by: amount, where: { id: accountId }, transaction: t });
  } else if (type === 'expense') {
    await CashAccount.decrement('current_balance', { by: amount, where: { id: accountId }, transaction: t });
  } else if (type === 'transfer') {
    if (!transferAccountId) throw new AppError('Cuenta destino requerida para transferencias', 400);
    await CashAccount.decrement('current_balance', { by: amount, where: { id: accountId }, transaction: t });
    await CashAccount.increment('current_balance', { by: amount, where: { id: transferAccountId }, transaction: t });
  }
}

export interface CreateTransactionInput {
  account_id: number;
  category_id: number;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description: string;
  date: string;
  reference_type?: 'invoice' | 'order' | 'store_order';
  reference_id?: number;
  transfer_account_id?: number;
  notes?: string;
  /** Reintento de red seguro: dos altas con la misma clave devuelven el mismo movimiento. */
  idempotency_key?: string;
}

/**
 * Núcleo compartido de creación (validación + efecto en saldo + insert),
 * siempre dentro de la transacción del caller. `createTransaction` (endpoint
 * del panel) abre la suya propia; `createSystemTransaction` (2.3 — llamada
 * desde otros servicios, p. ej. al confirmarse un pago de la tienda online)
 * participa de una transacción externa para que la carga en caja sea
 * atómica con el evento de negocio que la origina.
 */
async function createTransactionCore(
  input: CreateTransactionInput,
  ctx: CashAuditContext,
  t: import('sequelize').Transaction
): Promise<CashTransaction> {
  if (input.type === 'transfer') {
    if (!input.transfer_account_id) throw new AppError('Cuenta destino requerida para transferencias', 400);
    if (input.transfer_account_id === input.account_id) throw new AppError('La cuenta destino debe ser distinta a la cuenta origen', 400);
  }

  const accountExists = await CashAccount.count({ where: { id: input.account_id }, transaction: t });
  if (!accountExists) throw new AppError('Cuenta no encontrada', 404);

  await applyBalanceEffect(input.type, input.amount, input.account_id, input.transfer_account_id, t);

  const created = await CashTransaction.create(
    {
      account_id:          input.account_id,
      category_id:         input.category_id,
      type:                input.type,
      amount:              input.amount,
      description:         input.description,
      date:                input.date,
      reference_type:      input.reference_type || null,
      reference_id:        input.reference_id || null,
      transfer_account_id: input.transfer_account_id || null,
      created_by:          ctx.userId,
      notes:               input.notes || null,
      idempotency_key:     input.idempotency_key || null,
    },
    { transaction: t }
  );

  // La auditoría vive acá y no en `createTransaction` para cubrir con un solo
  // punto los dos caminos de alta: el panel y el automático de la tienda.
  await recordCashAudit(
    { entityType: 'transaction', entityId: created.id, action: 'create', after: snapshotOf(created), context: ctx },
    t
  );

  return created;
}

export async function createTransaction(input: CreateTransactionInput, ctx: CashAuditContext) {
  // Camino rápido: un reintento secuencial genuino (no una carrera) ya
  // encuentra el movimiento sin abrir una transacción ni generar auditoría de más.
  if (input.idempotency_key) {
    const existing = await CashTransaction.findOne({ where: { idempotency_key: input.idempotency_key } });
    if (existing) return getTransaction(existing.id);
  }

  let created: CashTransaction | null = null;
  try {
    await sequelize.transaction(async (t) => {
      created = await createTransactionCore(input, ctx, t);
    });
  } catch (err) {
    // Carrera genuina: dos requests con la misma clave llegaron a la vez y el
    // índice único de la DB (migración 091) frenó al segundo. No se duplica:
    // se devuelve el movimiento que ganó la carrera.
    //
    // No se filtra por `err.fields` (a diferencia del patrón equivalente en
    // `store.service.ts`): acá el modelo NO declara `unique: true` en el
    // atributo (a propósito, ver migración 091 — evita el índice duplicado
    // bajo `sync()`), y sin esa declaración Sequelize no siempre puede
    // resolver `fields` para este constraint. Es seguro igual: si el
    // `UniqueConstraintError` no fuera por `idempotency_key`, la búsqueda de
    // abajo no encuentra nada y se relanza el error original sin ocultarlo.
    if (err instanceof UniqueConstraintError && input.idempotency_key) {
      const existing = await CashTransaction.findOne({ where: { idempotency_key: input.idempotency_key } });
      if (existing) return getTransaction(existing.id);
    }
    throw err;
  }

  return getTransaction(created!.id);
}

/**
 * Ver `createTransactionCore` — requiere una transacción externa, nunca abre la
 * propia. `createdBy` es el usuario al que se atribuye el asiento (un admin si
 * confirmó el pago a mano, o el usuario "Sistema" si fue automático); no hay
 * IP ni user-agent porque no hay request humana detrás.
 */
export async function createSystemTransaction(
  input: CreateTransactionInput,
  createdBy: number,
  transaction: import('sequelize').Transaction
): Promise<CashTransaction> {
  return createTransactionCore(input, { userId: createdBy }, transaction);
}

/**
 * Edición limitada a campos no financieros. `amount`, `type`, `account_id`,
 * `transfer_account_id` y `date` de un movimiento confirmado NUNCA se tocan
 * acá, aunque el body los traiga — se construye el patch campo por campo, no
 * se spreadea `input` (mismo criterio que ya usa `createTransactionCore`).
 * Cualquier corrección de importe pasa por `reverseTransaction`.
 */
export interface PatchTransactionInput {
  description?: string;
  notes?: string | null;
  category_id?: number;
}

export async function patchTransaction(id: number, input: PatchTransactionInput, ctx: CashAuditContext) {
  const tx = await CashTransaction.findByPk(id);
  if (!tx) throw new AppError('Transacción no encontrada', 404);
  const before = snapshotOf(tx);

  const patch: PatchTransactionInput = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.category_id !== undefined) patch.category_id = input.category_id;

  await sequelize.transaction(async (t) => {
    await tx.update(patch, { transaction: t });
    await recordCashAudit(
      { entityType: 'transaction', entityId: tx.id, action: 'update', before, after: snapshotOf(tx), context: ctx },
      t
    );
  });

  return getTransaction(id);
}

export interface ReverseTransactionInput {
  reason: string;
  /** Reversión parcial (p. ej. una devolución que no es por el total). Por defecto: todo el saldo aún no revertido. */
  amount?: number;
}

/**
 * Único mecanismo de corrección de un movimiento confirmado: crea un
 * contraasiento (monto igual o parcial, tipo/cuentas invertidos) y deja el
 * original intacto en sus campos financieros — solo se le marca `status`
 * cuando queda completamente revertido. Soporta reversión parcial desde el
 * diseño (no se agrega después) porque la Fase 4 del plan la necesita para
 * devoluciones parciales de tienda.
 *
 * La fecha del contraasiento es SIEMPRE la de hoy, nunca la del movimiento
 * original: la corrección ocurre cuando se detecta, no se reescribe
 * retroactivamente un período ya cerrado (decisión confirmada con el usuario).
 */
export async function reverseTransaction(
  id: number,
  input: ReverseTransactionInput,
  ctx: CashAuditContext
): Promise<CashTransaction> {
  let reversalId: number | null = null;

  await sequelize.transaction(async (t) => {
    // Lock de fila: si dos reversiones de la misma transacción llegan casi
    // juntas, la segunda espera a que la primera commitee y ve el `remaining`
    // ya actualizado — sin esto habría una condición de carrera real (CASH-CONC-001).
    const original = await CashTransaction.findByPk(id, { lock: Transaction.LOCK.UPDATE, transaction: t });
    if (!original) throw new AppError('Transacción no encontrada', 404);
    if (original.reversal_of_id) throw new AppError('Una reversión no se puede volver a revertir', 400);
    if (original.status === 'reversed') throw new AppError('La transacción ya fue revertida por completo', 400);

    const originalAmount = Number(original.amount);
    const alreadyReversed = Number(
      (await CashTransaction.sum('amount', { where: { reversal_of_id: original.id }, transaction: t })) ?? 0
    );
    const remaining = originalAmount - alreadyReversed;
    const amountToReverse = input.amount ?? remaining;

    if (amountToReverse <= 0) throw new AppError('El monto a revertir debe ser mayor a 0', 400);
    // Margen de un décimo de centavo por acumulación de redondeo en sumas sucesivas.
    if (amountToReverse > remaining + 0.001) {
      throw new AppError(
        `No se puede revertir ${amountToReverse}: solo queda ${remaining.toFixed(2)} sin revertir de esta transacción`,
        400
      );
    }

    // income↔expense; transfer invierte cuenta origen/destino.
    let reversalType: 'income' | 'expense' | 'transfer';
    let reversalAccountId: number;
    let reversalTransferAccountId: number | null;
    if (original.type === 'income') {
      reversalType = 'expense';
      reversalAccountId = original.account_id;
      reversalTransferAccountId = null;
    } else if (original.type === 'expense') {
      reversalType = 'income';
      reversalAccountId = original.account_id;
      reversalTransferAccountId = null;
    } else {
      reversalType = 'transfer';
      reversalAccountId = original.transfer_account_id!;
      reversalTransferAccountId = original.account_id;
    }

    await applyBalanceEffect(reversalType, amountToReverse, reversalAccountId, reversalTransferAccountId, t);

    const before = snapshotOf(original);
    const today = new Date().toISOString().slice(0, 10);

    const reversal = await CashTransaction.create(
      {
        account_id:          reversalAccountId,
        category_id:         original.category_id,
        type:                reversalType,
        amount:              amountToReverse,
        description:         `Reversión de #${original.id} — ${original.description}`,
        date:                today,
        reference_type:      original.reference_type,
        reference_id:        original.reference_id,
        transfer_account_id: reversalTransferAccountId,
        created_by:          ctx.userId,
        notes:               input.reason,
        reversal_of_id:      original.id,
        reversal_reason:     input.reason,
      },
      { transaction: t }
    );

    const fullyReversed = amountToReverse >= remaining - 0.001;
    if (fullyReversed) {
      await original.update(
        { status: 'reversed', reversed_at: new Date(), reversed_by: ctx.userId },
        { transaction: t }
      );
    }

    await recordCashAudit(
      {
        entityType: 'transaction', entityId: original.id, action: 'reverse',
        before, after: snapshotOf(original), reason: input.reason, context: ctx,
      },
      t
    );
    await recordCashAudit(
      {
        entityType: 'transaction', entityId: reversal.id, action: 'reverse',
        after: snapshotOf(reversal), reason: input.reason, context: ctx,
      },
      t
    );

    reversalId = reversal.id;
  });

  return getTransaction(reversalId!);
}

// ── Resumen ───────────────────────────────────────────────────────────────────

export async function getSummary(period?: string): Promise<SummaryResult> {
  const { dateFrom, dateTo, periodLabel } = parsePeriod(period);

  const accounts = await CashAccount.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  });

  const totals = await sequelize.query<{
    total_income: string; total_expense: string;
  }>(
    `SELECT
       SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS total_income,
       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense
     FROM cash_transactions
     WHERE date BETWEEN :dateFrom AND :dateTo`,
    { replacements: { dateFrom, dateTo }, type: QueryTypes.SELECT }
  );

  const totalIncome  = Number(totals[0]?.total_income  ?? 0);
  const totalExpense = Number(totals[0]?.total_expense ?? 0);

  const byCategory = await sequelize.query<{
    category_id: number; name: string; type: string; color: string | null; total: string;
  }>(
    `SELECT
       ct.category_id,
       ctc.name,
       ctc.type,
       ctc.color,
       SUM(ct.amount) AS total
     FROM cash_transactions ct
     JOIN cash_transaction_categories ctc ON ctc.id = ct.category_id
     WHERE ct.date BETWEEN :dateFrom AND :dateTo
       AND ct.type != 'transfer'
     GROUP BY ct.category_id, ctc.name, ctc.type, ctc.color
     ORDER BY total DESC`,
    { replacements: { dateFrom, dateTo }, type: QueryTypes.SELECT }
  );

  const dailyEvolution = await sequelize.query<{
    date: string; income: string; expense: string;
  }>(
    `SELECT
       date,
       SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
     FROM cash_transactions
     WHERE date BETWEEN :dateFrom AND :dateTo
     GROUP BY date
     ORDER BY date ASC`,
    { replacements: { dateFrom, dateTo }, type: QueryTypes.SELECT }
  );

  return {
    accounts: accounts.map((a) => ({
      id:              a.id,
      name:            a.name,
      type:            a.type as 'cash' | 'petty_cash' | 'bank',
      current_balance: Number(a.current_balance),
    })),
    total_income:  totalIncome,
    total_expense: totalExpense,
    net_balance:   totalIncome - totalExpense,
    by_category: byCategory.map((r) => ({
      category_id: r.category_id,
      name:        r.name,
      type:        r.type,
      color:       r.color,
      total:       Number(r.total),
    })),
    daily_evolution: dailyEvolution.map((r) => {
      const inc = Number(r.income);
      const exp = Number(r.expense);
      return { date: r.date, income: inc, expense: exp, net: inc - exp };
    }),
    period_label: periodLabel,
  };
}
