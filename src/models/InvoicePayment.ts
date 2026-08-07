import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type InvoicePaymentMethod = 'cash' | 'bank_transfer' | 'mercadopago';

export class InvoicePayment extends Model<
  InferAttributes<InvoicePayment>,
  InferCreationAttributes<InvoicePayment>
> {
  declare id: CreationOptional<number>;
  declare invoice_id: number;
  declare amount: number;
  declare payment_method: InvoicePaymentMethod;
  declare paid_at: CreationOptional<Date>;
  declare notes: CreationOptional<string | null>;
  /** Cuándo se creó el asiento de caja de ESTE cobro (DEC-012). Null si la cuenta destino no está configurada — BR-CASH-008: nunca bloquea el registro del cobro. */
  declare cash_recorded_at: CreationOptional<Date | null>;
  /** Reintento de red seguro: dos altas con la misma clave devuelven el mismo cobro. Sin `unique: true` acá a propósito, ver migración 093. */
  declare idempotency_key: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

InvoicePayment.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    invoice_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      get() { return parseFloat(String(this.getDataValue('amount'))); },
    },
    payment_method: { type: DataTypes.ENUM('cash', 'bank_transfer', 'mercadopago'), allowNull: false },
    paid_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    cash_recorded_at: { type: DataTypes.DATE, allowNull: true },
    idempotency_key: { type: DataTypes.STRING(80), allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'invoice_payments' }
);
