import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreCoupon extends Model<
  InferAttributes<StoreCoupon>,
  InferCreationAttributes<StoreCoupon>
> {
  declare id: CreationOptional<number>;
  declare code: string;
  declare description: CreationOptional<string | null>;
  declare type: 'percentage' | 'fixed';
  declare value: number;
  declare min_purchase: CreationOptional<number | null>;
  declare max_uses: CreationOptional<number | null>;
  declare used_count: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare starts_at: CreationOptional<Date | null>;
  declare expires_at: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreCoupon.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(300), allowNull: true },
    type: { type: DataTypes.ENUM('percentage', 'fixed'), allowNull: false },
    value: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get() {
        const v = this.getDataValue('value');
        return v === null ? null : parseFloat(String(v));
      },
    },
    min_purchase: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue('min_purchase');
        return v === null ? null : parseFloat(String(v));
      },
    },
    max_uses: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    used_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    starts_at: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_coupons', timestamps: true }
);
