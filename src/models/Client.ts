import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class Client extends Model<
  InferAttributes<Client>,
  InferCreationAttributes<Client>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare contact_name: CreationOptional<string | null>;
  declare phone: CreationOptional<string | null>;
  declare email: CreationOptional<string | null>;
  declare address: CreationOptional<string | null>;
  declare cuit: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Client.init(
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
    contact_name: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: { isEmail: true },
    },
    address: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    cuit: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'clients',
    timestamps: true,
  }
);
