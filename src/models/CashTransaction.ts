import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import { sequelize } from '../config/db';

export type CashTransactionStatus = 'active' | 'reversed';

export class CashTransaction extends Model<
  InferAttributes<CashTransaction>,
  InferCreationAttributes<CashTransaction>
> {
  declare id: CreationOptional<number>;
  declare account_id: number;
  declare category_id: number;
  declare type: 'income' | 'expense' | 'transfer';
  declare amount: number;
  declare description: string;
  declare date: string;
  declare reference_type: CreationOptional<'invoice' | 'order' | 'store_order' | null>;
  declare reference_id: CreationOptional<number | null>;
  declare transfer_account_id: CreationOptional<number | null>;
  declare created_by: number;
  declare notes: CreationOptional<string | null>;

  /**
   * `active`: movimiento vigente (puede estar parcialmente revertido, ver
   * `reverse.md` en el plan de corrección — una reversión parcial no cambia
   * el status del original). `reversed`: se revirtió por el monto total, ya
   * no queda saldo pendiente de revertir.
   */
  declare status: CreationOptional<CashTransactionStatus>;
  /** Si esta fila ES un contraasiento, apunta al movimiento que revierte. NULL en movimientos normales. */
  declare reversal_of_id: CreationOptional<number | null>;
  /** Motivo de la reversión — solo tiene sentido cuando esta fila es un contraasiento. */
  declare reversal_reason: CreationOptional<string | null>;
  /** Cuándo el ORIGINAL quedó completamente revertido (no se usa en el contraasiento). */
  declare reversed_at: CreationOptional<Date | null>;
  declare reversed_by: CreationOptional<number | null>;

  /** Clave opcional para que un reintento de red no duplique el alta. Única a nivel de índice (ver migración 091). */
  declare idempotency_key: CreationOptional<string | null>;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare reversal_of?: NonAttribute<CashTransaction | null>;
  declare reversals?: NonAttribute<CashTransaction[]>;
  declare reverser?: NonAttribute<import('./User').User | null>;
}

CashTransaction.init(
  {
    id:                  { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    account_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    category_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type:                { type: DataTypes.ENUM('income', 'expense', 'transfer'), allowNull: false },
    amount:              { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    description:         { type: DataTypes.STRING(255), allowNull: false },
    date:                { type: DataTypes.DATEONLY, allowNull: false },
    reference_type:      { type: DataTypes.ENUM('invoice', 'order', 'store_order'), allowNull: true },
    reference_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    transfer_account_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    notes:               { type: DataTypes.TEXT, allowNull: true },
    status:              { type: DataTypes.ENUM('active', 'reversed'), allowNull: false, defaultValue: 'active' },
    reversal_of_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    reversal_reason:     { type: DataTypes.STRING(500), allowNull: true },
    reversed_at:         { type: DataTypes.DATE, allowNull: true },
    reversed_by:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    // Sin `unique: true` acá a propósito — ver nota en la migración 091.
    idempotency_key:     { type: DataTypes.STRING(80), allowNull: true },
    createdAt:           DataTypes.DATE,
    updatedAt:           DataTypes.DATE,
  },
  { sequelize, tableName: 'cash_transactions', timestamps: true }
);
