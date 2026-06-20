import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreAddress extends Model<
  InferAttributes<StoreAddress>,
  InferCreationAttributes<StoreAddress>
> {
  declare id: CreationOptional<number>;
  declare customer_id: number;
  declare label: CreationOptional<string | null>;
  declare street: string;
  declare city: string;
  declare state: CreationOptional<string | null>;
  declare zip_code: CreationOptional<string | null>;
  declare country: CreationOptional<string>;
  declare is_default: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreAddress.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    label: { type: DataTypes.STRING(100), allowNull: true },
    street: { type: DataTypes.STRING(300), allowNull: false },
    city: { type: DataTypes.STRING(100), allowNull: false },
    state: { type: DataTypes.STRING(100), allowNull: true },
    zip_code: { type: DataTypes.STRING(20), allowNull: true },
    country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'Argentina' },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_addresses', timestamps: true }
);
