import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';
import { UserRole } from '../types';

export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare password_hash: string;
  declare role: UserRole;
  declare active: CreationOptional<boolean>;
  declare session_version: CreationOptional<number>;
  declare welcome_email_sent_at: CreationOptional<Date | null>;
  declare welcome_email_error: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { isEmail: true },
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM('admin', 'billing', 'workshop', 'seller'),
      allowNull: false,
      defaultValue: 'workshop',
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    session_version: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
    welcome_email_sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    welcome_email_error: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
  }
);
