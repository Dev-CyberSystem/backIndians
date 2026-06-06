import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class CashTransactionCategory extends Model<
  InferAttributes<CashTransactionCategory>,
  InferCreationAttributes<CashTransactionCategory>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: 'income' | 'expense' | 'both';
  declare color: CreationOptional<string | null>;
  declare is_system: CreationOptional<boolean>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CashTransactionCategory.init(
  {
    id:        { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name:      { type: DataTypes.STRING(150), allowNull: false },
    type:      { type: DataTypes.ENUM('income', 'expense', 'both'), allowNull: false },
    color:     { type: DataTypes.STRING(10), allowNull: true },
    is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    active:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'cash_transaction_categories', timestamps: true }
);
