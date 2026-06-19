import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class InvoicePayment extends Model<
  InferAttributes<InvoicePayment>,
  InferCreationAttributes<InvoicePayment>
> {
  declare id: CreationOptional<number>;
  declare invoice_id: number;
  declare amount: number;
  declare paid_at: CreationOptional<Date>;
  declare notes: CreationOptional<string | null>;
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
    paid_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'invoice_payments' }
);
