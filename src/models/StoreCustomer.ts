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
  declare token_expires_at: CreationOptional<Date | null>;
  declare avatar_url: CreationOptional<string | null>;
  declare phone: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare session_version: CreationOptional<number>;
  /** Última aceptación de T&C/Privacidad (el detalle vive en `legal_acceptances`). */
  declare terms_accepted_at: CreationOptional<Date | null>;
  declare terms_version: CreationOptional<string | null>;
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
    token_expires_at: { type: DataTypes.DATE, allowNull: true },
    avatar_url: { type: DataTypes.STRING(500), allowNull: true },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    session_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    terms_accepted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    terms_version: { type: DataTypes.STRING(20), allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_customers', timestamps: true }
);
