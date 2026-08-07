import { Model, Transaction } from 'sequelize';
import { CashAuditEvent, CashAuditEntityType, CashAuditAction } from '../models/CashAuditEvent';
import { User } from '../models/User';
import { AuthRequest } from '../types';

/**
 * Auditoría del módulo de caja (Fase 1 — hallazgo CASH-AUDIT-001).
 *
 * Regla central: `recordCashAudit` **nunca abre su propia transacción**, exige
 * la del caller. El evento de auditoría tiene que ser atómico con el cambio
 * que documenta — si el movimiento se revierte por un error, su rastro de
 * auditoría también, o quedaría un evento describiendo algo que no pasó.
 * (Mismo criterio que ya usa `createSystemTransaction` en `cash.service.ts`.)
 *
 * Los intentos **denegados** (403) no se registran acá a propósito: ya los
 * cubre el log operacional de Pino, que registra el `AppError` junto al
 * operador y el `correlationId`. Duplicarlos ensuciaría el registro contable,
 * que debe contener hechos consumados.
 */

/** Contexto técnico de quién ejecuta la acción. */
export interface CashAuditContext {
  userId: number;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface RecordCashAuditInput {
  entityType: CashAuditEntityType;
  entityId: number;
  action: CashAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  context: CashAuditContext;
}

/**
 * Extrae el contexto de auditoría de una request autenticada. `requestContext.ts`
 * ya dejó `correlationId` en el request, así que un evento de caja se puede
 * cruzar con el log HTTP que lo originó.
 */
export function auditContextFromRequest(req: AuthRequest): CashAuditContext {
  const r = req as AuthRequest & { correlationId?: string };
  return {
    userId: req.user!.id,
    ip: req.ip ?? null,
    userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null,
    correlationId: r.correlationId ?? null,
  };
}

/**
 * Snapshot plano de una instancia Sequelize, limitado a sus columnas reales.
 *
 * Se filtra por `getAttributes()` para dejar afuera las asociaciones cargadas
 * con `include` (`account`, `category`, `creator`…): al auditar interesa el
 * estado de la fila, no el de las tablas vecinas — y sin filtrar, un snapshot
 * de movimiento arrastraría el usuario completo con su hash de contraseña.
 */
export function snapshotOf<M extends Model>(instance: M): Record<string, unknown> {
  const modelClass = instance.constructor as unknown as {
    getAttributes(): Record<string, unknown>;
  };
  const attributeNames = Object.keys(modelClass.getAttributes());
  const plain = instance.get({ plain: true }) as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const key of attributeNames) {
    if (key in plain) out[key] = plain[key];
  }
  return out;
}

/** Registra un evento de auditoría. Requiere la transacción del caller. */
export async function recordCashAudit(
  input: RecordCashAuditInput,
  transaction: Transaction
): Promise<void> {
  await CashAuditEvent.create(
    {
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      user_id: input.context.userId,
      before_json: input.before ?? null,
      after_json: input.after ?? null,
      reason: input.reason ?? null,
      ip: input.context.ip ?? null,
      user_agent: input.context.userAgent ?? null,
      correlation_id: input.context.correlationId ?? null,
    },
    { transaction }
  );
}

// ── Consulta ──────────────────────────────────────────────────────────────────

export interface ListCashAuditOptions {
  entity_type?: CashAuditEntityType;
  entity_id?: number;
  action?: CashAuditAction;
  user_id?: number;
  page: number;
  limit: number;
}

export async function listCashAuditEvents(options: ListCashAuditOptions) {
  const { page, limit } = options;
  const where: Record<string, unknown> = {};
  if (options.entity_type) where.entity_type = options.entity_type;
  if (options.entity_id) where.entity_id = options.entity_id;
  if (options.action) where.action = options.action;
  if (options.user_id) where.user_id = options.user_id;

  const { rows, count } = await CashAuditEvent.findAndCountAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'role'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return { events: rows, total: count, page, limit };
}
