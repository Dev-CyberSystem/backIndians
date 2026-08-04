import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type CatalogStockMovementType = 'sale' | 'return' | 'cancel' | 'adjustment' | 'in' | 'out' | 'transfer' | 'reserve' | 'release';
export type CatalogStockMovementSource = 'store' | 'catalog' | 'manual' | 'system';

export class CatalogStockMovement extends Model<
  InferAttributes<CatalogStockMovement>,
  InferCreationAttributes<CatalogStockMovement>
> {
  declare id: CreationOptional<number>;
  declare catalog_product_id: number;
  declare catalog_product_size_id: CreationOptional<number | null>;
  declare type: CatalogStockMovementType;
  declare quantity: number;
  declare previous_quantity: number;
  declare new_quantity: number;
  declare reason: CreationOptional<string | null>;
  declare source: CatalogStockMovementSource;
  declare store_order_id: CreationOptional<number | null>;
  declare catalog_order_id: CreationOptional<number | null>;
  declare user_id: CreationOptional<number | null>;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogStockMovement.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    catalog_product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    catalog_product_size_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    type: {
      type: DataTypes.ENUM('sale', 'return', 'cancel', 'adjustment', 'in', 'out', 'transfer', 'reserve', 'release'),
      allowNull: false,
    },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    previous_quantity: { type: DataTypes.INTEGER, allowNull: false },
    new_quantity: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    source: { type: DataTypes.ENUM('store', 'catalog', 'manual', 'system'), allowNull: false },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    catalog_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'catalog_stock_movements', timestamps: true }
);
