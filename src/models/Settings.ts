import { DataTypes, Model, InferAttributes, InferCreationAttributes } from 'sequelize';
import { sequelize } from '../config/db';

export class Settings extends Model<
  InferAttributes<Settings>,
  InferCreationAttributes<Settings>
> {
  declare key: string;
  declare value: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Settings.init(
  {
    key: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'settings',
    timestamps: true,
  }
);
