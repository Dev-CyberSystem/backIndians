import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

/** Contador atómico del número de pedido de tienda (ECOM-YYYYMMDD-NNNN). Ver migración 100. */
export class StoreOrderSequence extends Model<
  InferAttributes<StoreOrderSequence>,
  InferCreationAttributes<StoreOrderSequence>
> {
  declare date_key: string;
  declare next_seq: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreOrderSequence.init(
  {
    date_key: { type: DataTypes.STRING(8), primaryKey: true, allowNull: false },
    next_seq: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_order_sequences', timestamps: true }
);
