import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';

export type CashAuditEntityType = 'transaction' | 'account' | 'category';

/**
 * `delete` existe para cubrir el borrado de movimientos que la API todavía
 * permite. La Fase 2 del plan lo reemplaza por `reverse` y el endpoint
 * desaparece, pero el valor se conserva para que los eventos históricos
 * sigan siendo legibles.
 */
export type CashAuditAction = 'create' | 'update' | 'reverse' | 'delete' | 'toggle';

/**
 * Evento de auditoría del módulo de caja (migración 090). Registra qué cambió,
 * quién lo cambió y con qué valores antes/después.
 *
 * La tabla es **append-only**: no tiene `updatedAt` y los hooks de abajo
 * bloquean cualquier intento de actualizar o borrar una fila, incluso desde
 * código interno. No es solo una convención documentada — si alguien más
 * adelante llama `evento.update(...)` o `destroy()`, revienta en el acto.
 */
export class CashAuditEvent extends Model<
  InferAttributes<CashAuditEvent>,
  InferCreationAttributes<CashAuditEvent>
> {
  declare id: CreationOptional<number>;
  declare entity_type: CashAuditEntityType;
  declare entity_id: number;
  declare action: CashAuditAction;
  /** Usuario responsable. Para procesos automáticos, el usuario "Sistema" (migración 084). */
  declare user_id: number;
  declare before_json: CreationOptional<Record<string, unknown> | null>;
  declare after_json: CreationOptional<Record<string, unknown> | null>;
  declare reason: CreationOptional<string | null>;
  declare ip: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare correlation_id: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;

  declare actor?: NonAttribute<import('./User').User>;
}

CashAuditEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    entity_type: {
      type: DataTypes.ENUM('transaction', 'account', 'category'),
      allowNull: false,
    },
    entity_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    action: {
      type: DataTypes.ENUM('create', 'update', 'reverse', 'delete', 'toggle'),
      allowNull: false,
    },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    before_json: { type: DataTypes.JSON, allowNull: true },
    after_json: { type: DataTypes.JSON, allowNull: true },
    reason: { type: DataTypes.STRING(500), allowNull: true },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    correlation_id: { type: DataTypes.STRING(64), allowNull: true },
    createdAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'cash_audit_events',
    timestamps: true,
    updatedAt: false, // append-only: una fila de auditoría no se actualiza nunca
  }
);

// ── Inmutabilidad forzada a nivel de modelo ───────────────────────────────────
// No alcanza con "no exponer endpoints de escritura": si mañana alguien agrega
// código que intente pisar un evento, tiene que fallar ruidosamente.

const APPEND_ONLY = 'cash_audit_events es append-only: un evento de auditoría no se puede modificar ni eliminar';

CashAuditEvent.beforeUpdate(() => { throw new Error(APPEND_ONLY); });
CashAuditEvent.beforeDestroy(() => { throw new Error(APPEND_ONLY); });
CashAuditEvent.beforeBulkUpdate(() => { throw new Error(APPEND_ONLY); });
CashAuditEvent.beforeBulkDestroy(() => { throw new Error(APPEND_ONLY); });
