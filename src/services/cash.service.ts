import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import {
  CashAccount, CashTransactionCategory, CashTransaction, User,
} from '../models';
import { AppError } from '../middlewares/errorHandler';
import { JwtPayload } from '../types';

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

export async function createAccount(input: {
  name: string;
  type: 'cash' | 'petty_cash' | 'bank';
  description?: string;
}) {
  return CashAccount.create({
    name: input.name,
    type: input.type,
    description: input.description || null,
    current_balance: 0,
    active: true,
  });
}

export async function updateAccount(id: number, input: {
  name?: string;
  type?: 'cash' | 'petty_cash' | 'bank';
  description?: string;
}) {
  const acc = await CashAccount.findByPk(id);
  if (!acc) throw new AppError('Cuenta no encontrada', 404);
  await acc.update(input);
  return acc;
}

export async function toggleAccount(id: number) {
  const acc = await CashAccount.findByPk(id);
  if (!acc) throw new AppError('Cuenta no encontrada', 404);
  await acc.update({ active: !acc.active });
  return acc;
}

// ── Categorías ────────────────────────────────────────────────────────────────

export async function listCategories() {
  return CashTransactionCategory.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  });
}

export async function createCategory(input: {
  name: string;
  type: 'income' | 'expense' | 'both';
  color?: string;
}) {
  return CashTransactionCategory.create({
    name: input.name,
    type: input.type,
    color: input.color || null,
    is_system: false,
    active: true,
  });
}

export async function updateCategory(id: number, input: {
  name?: string;
  type?: 'income' | 'expense' | 'both';
  color?: string;
}) {
  const cat = await CashTransactionCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  if (cat.is_system) throw new AppError('No se pueden editar categorías del sistema', 403);
  await cat.update(input);
  return cat;
}

export async function toggleCategory(id: number) {
  const cat = await CashTransactionCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  if (cat.is_system) throw new AppError('No se pueden desactivar categorías del sistema', 403);
  await cat.update({ active: !cat.active });
  return cat;
}

// ── Transacciones ─────────────────────────────────────────────────────────────

const TX_INCLUDES = [
  { model: CashAccount, as: 'account', attributes: ['id', 'name', 'type'] },
  { model: CashAccount, as: 'transfer_account', attributes: ['id', 'name', 'type'] },
  { model: CashTransactionCategory, as: 'category', attributes: ['id', 'name', 'type', 'color'] },
  { model: User, as: 'creator', attributes: ['id', 'name', 'role'] },
];

export interface ListTransactionsOptions {
  account_id?: number;
  category_id?: number;
  type?: 'income' | 'expense' | 'transfer';
  date_from?: string;
  date_to?: string;
  reference_type?: 'invoice' | 'order';
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

// Revierte el efecto previo de una transacción
async function revertBalanceEffect(
  type: 'income' | 'expense' | 'transfer',
  amount: number,
  accountId: number,
  transferAccountId: number | null | undefined,
  t: import('sequelize').Transaction
) {
  if (type === 'income') {
    await CashAccount.decrement('current_balance', { by: amount, where: { id: accountId }, transaction: t });
  } else if (type === 'expense') {
    await CashAccount.increment('current_balance', { by: amount, where: { id: accountId }, transaction: t });
  } else if (type === 'transfer') {
    if (!transferAccountId) return;
    await CashAccount.increment('current_balance', { by: amount, where: { id: accountId }, transaction: t });
    await CashAccount.decrement('current_balance', { by: amount, where: { id: transferAccountId }, transaction: t });
  }
}

export interface CreateTransactionInput {
  account_id: number;
  category_id: number;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description: string;
  date: string;
  reference_type?: 'invoice' | 'order';
  reference_id?: number;
  transfer_account_id?: number;
  notes?: string;
}

export async function createTransaction(input: CreateTransactionInput, currentUser: JwtPayload) {
  if (input.type === 'transfer') {
    if (!input.transfer_account_id) throw new AppError('Cuenta destino requerida para transferencias', 400);
    if (input.transfer_account_id === input.account_id) throw new AppError('La cuenta destino debe ser distinta a la cuenta origen', 400);
  }

  const accountExists = await CashAccount.count({ where: { id: input.account_id } });
  if (!accountExists) throw new AppError('Cuenta no encontrada', 404);

  let created: CashTransaction | null = null;

  await sequelize.transaction(async (t) => {
    await applyBalanceEffect(input.type, input.amount, input.account_id, input.transfer_account_id, t);

    created = await CashTransaction.create(
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
        created_by:          currentUser.id,
        notes:               input.notes || null,
      },
      { transaction: t }
    );
  });

  return getTransaction(created!.id);
}

export interface UpdateTransactionInput extends Partial<CreateTransactionInput> {}

export async function updateTransaction(id: number, input: UpdateTransactionInput) {
  const tx = await CashTransaction.findByPk(id);
  if (!tx) throw new AppError('Transacción no encontrada', 404);

  const newType   = input.type   ?? tx.type;
  const newAmount = input.amount ?? Number(tx.amount);
  const newAccountId = input.account_id ?? tx.account_id;
  const newTransferAccountId = input.transfer_account_id !== undefined
    ? input.transfer_account_id
    : tx.transfer_account_id;

  if (newType === 'transfer') {
    if (!newTransferAccountId) throw new AppError('Cuenta destino requerida para transferencias', 400);
    if (newTransferAccountId === newAccountId) throw new AppError('La cuenta destino debe ser distinta a la cuenta origen', 400);
  }

  const oldType              = tx.type;
  const oldAmount            = Number(tx.amount);
  const oldAccountId         = tx.account_id;
  const oldTransferAccountId = tx.transfer_account_id;

  await sequelize.transaction(async (t) => {
    // Revertir efecto anterior
    await revertBalanceEffect(oldType, oldAmount, oldAccountId, oldTransferAccountId, t);
    // Aplicar efecto nuevo
    await applyBalanceEffect(newType, newAmount, newAccountId, newTransferAccountId, t);

    await tx.update(
      {
        account_id:          newAccountId,
        category_id:         input.category_id         ?? tx.category_id,
        type:                newType,
        amount:              newAmount,
        description:         input.description         ?? tx.description,
        date:                input.date                ?? tx.date,
        reference_type:      input.reference_type      ?? tx.reference_type,
        reference_id:        input.reference_id        ?? tx.reference_id,
        transfer_account_id: newTransferAccountId,
        notes:               input.notes               ?? tx.notes,
      },
      { transaction: t }
    );
  });

  return getTransaction(id);
}

export async function deleteTransaction(id: number) {
  const tx = await CashTransaction.findByPk(id);
  if (!tx) throw new AppError('Transacción no encontrada', 404);

  await sequelize.transaction(async (t) => {
    await revertBalanceEffect(tx.type, Number(tx.amount), tx.account_id, tx.transfer_account_id, t);
    await tx.destroy({ transaction: t });
  });
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
