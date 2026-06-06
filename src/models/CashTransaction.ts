import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

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
  declare reference_type: CreationOptional<'invoice' | 'order' | null>;
  declare reference_id: CreationOptional<number | null>;
  declare transfer_account_id: CreationOptional<number | null>;
  declare created_by: number;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
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
    reference_type:      { type: DataTypes.ENUM('invoice', 'order'), allowNull: true },
    reference_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    transfer_account_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    notes:               { type: DataTypes.TEXT, allowNull: true },
    createdAt:           DataTypes.DATE,
    updatedAt:           DataTypes.DATE,
  },
  { sequelize, tableName: 'cash_transactions', timestamps: true }
);
