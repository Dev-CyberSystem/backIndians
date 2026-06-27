import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreCustomer extends Model<
  InferAttributes<StoreCustomer>,
  InferCreationAttributes<StoreCustomer>
> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare name: string;
  declare password_hash: CreationOptional<string | null>;
  declare google_id: CreationOptional<string | null>;
  declare email_verified: CreationOptional<boolean>;
  declare verification_token: CreationOptional<string | null>;
  declare avatar_url: CreationOptional<string | null>;
  declare phone: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreCustomer.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    password_hash: { type: DataTypes.STRING(255), allowNull: true },
    google_id: { type: DataTypes.STRING(255), allowNull: true, unique: true },
    email_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verification_token: { type: DataTypes.STRING(255), allowNull: true },
    avatar_url: { type: DataTypes.STRING(500), allowNull: true },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_customers', timestamps: true }
);
