import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StockItem extends Model<
  InferAttributes<StockItem>,
  InferCreationAttributes<StockItem>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare category: CreationOptional<string | null>;
  declare unit: string;
  declare current_quantity: CreationOptional<number>;
  declare min_quantity: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StockItem.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'unidad',
    },
    current_quantity: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    min_quantity: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'stock_items',
    timestamps: true,
  }
);
