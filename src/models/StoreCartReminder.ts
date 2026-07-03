import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreCartReminder extends Model<
  InferAttributes<StoreCartReminder>,
  InferCreationAttributes<StoreCartReminder>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare sent_by: CreationOptional<number | null>;
  declare product_ids: CreationOptional<number[] | null>;
  declare last_cart_add_at: CreationOptional<Date | null>;
  declare sent_at: Date;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreCartReminder.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    sent_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    product_ids: { type: DataTypes.JSON, allowNull: true },
    last_cart_add_at: { type: DataTypes.DATE, allowNull: true },
    sent_at: { type: DataTypes.DATE, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_cart_reminders', timestamps: true }
);
