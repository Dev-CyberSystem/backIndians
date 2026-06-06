import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class CashAccount extends Model<
  InferAttributes<CashAccount>,
  InferCreationAttributes<CashAccount>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: 'cash' | 'petty_cash' | 'bank';
  declare current_balance: CreationOptional<number>;
  declare description: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CashAccount.init(
  {
    id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name:            { type: DataTypes.STRING(150), allowNull: false },
    type:            { type: DataTypes.ENUM('cash', 'petty_cash', 'bank'), allowNull: false },
    current_balance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    description:     { type: DataTypes.TEXT, allowNull: true },
    active:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt:       DataTypes.DATE,
    updatedAt:       DataTypes.DATE,
  },
  { sequelize, tableName: 'cash_accounts', timestamps: true }
);
