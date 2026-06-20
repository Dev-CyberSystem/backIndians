import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreOrderItem extends Model<
  InferAttributes<StoreOrderItem>,
  InferCreationAttributes<StoreOrderItem>
> {
  declare id: CreationOptional<number>;
  declare store_order_id: number;
  declare catalog_product_id: number;
  declare product_title: string;
  declare size_name: CreationOptional<string | null>;
  declare quantity: number;
  declare unit_price: number;
  declare subtotal: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreOrderItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    catalog_product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    product_title: { type: DataTypes.STRING(200), allowNull: false },
    size_name: { type: DataTypes.STRING(50), allowNull: true },
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get() {
        const v = this.getDataValue('unit_price');
        return v === null ? null : parseFloat(String(v));
      },
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get() {
        const v = this.getDataValue('subtotal');
        return v === null ? null : parseFloat(String(v));
      },
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_order_items', timestamps: true }
);
