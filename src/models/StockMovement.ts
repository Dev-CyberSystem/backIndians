import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type MovementType = 'in' | 'out' | 'adjustment';

export class StockMovement extends Model<
  InferAttributes<StockMovement>,
  InferCreationAttributes<StockMovement>
> {
  declare id: CreationOptional<number>;
  declare stock_item_id: number;
  declare type: MovementType;
  declare quantity: number;
  declare previous_quantity: number;
  declare new_quantity: number;
  declare notes: CreationOptional<string | null>;
  declare user_id: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StockMovement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    stock_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: { type: DataTypes.ENUM('in', 'out', 'adjustment'), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
    previous_quantity: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
    new_quantity: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.TEXT, allowNull: true },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'stock_movements', timestamps: true }
);
