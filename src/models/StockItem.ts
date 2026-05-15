import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class StockItem extends Model<
  InferAttributes<StockItem>,
  InferCreationAttributes<StockItem>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare category_id: CreationOptional<number | null>;
  declare unit: string;
  declare current_quantity: CreationOptional<number>;
  declare min_quantity: CreationOptional<number>;
  declare description: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StockItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    unit: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'unidad' },
    current_quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
    min_quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
    description: { type: DataTypes.TEXT, allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'stock_items', timestamps: true }
);
