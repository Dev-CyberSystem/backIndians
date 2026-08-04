import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type StoreReturnItemCondition = 'resellable' | 'not_resellable';

export class StoreReturnItem extends Model<
  InferAttributes<StoreReturnItem>,
  InferCreationAttributes<StoreReturnItem>
> {
  declare id: CreationOptional<number>;
  declare store_return_id: number;
  declare store_order_item_id: number;
  declare quantity: number;
  declare condition: CreationOptional<StoreReturnItemCondition | null>;
  declare restocked_at: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreReturnItem.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    store_return_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    store_order_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    condition: { type: DataTypes.ENUM('resellable', 'not_resellable'), allowNull: true, defaultValue: null },
    restocked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_return_items', timestamps: true }
);
