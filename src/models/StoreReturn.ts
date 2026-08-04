import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type StoreReturnStatus = 'pending_review' | 'approved' | 'rejected';
export type StoreReturnRefundStatus = 'none' | 'pending' | 'refunded';

export class StoreReturn extends Model<
  InferAttributes<StoreReturn>,
  InferCreationAttributes<StoreReturn>
> {
  declare id: CreationOptional<number>;
  declare store_order_id: number;
  declare status: CreationOptional<StoreReturnStatus>;
  declare reason: CreationOptional<string | null>;
  declare refund_status: CreationOptional<StoreReturnRefundStatus>;
  declare refunded_amount: CreationOptional<number | null>;
  declare refunded_at: CreationOptional<Date | null>;
  declare requested_by: CreationOptional<number | null>;
  declare reviewed_by: CreationOptional<number | null>;
  declare reviewed_at: CreationOptional<Date | null>;
  declare review_notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreReturn.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    status: { type: DataTypes.ENUM('pending_review', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending_review' },
    reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    refund_status: { type: DataTypes.ENUM('none', 'pending', 'refunded'), allowNull: false, defaultValue: 'none' },
    refunded_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get() {
        const v = this.getDataValue('refunded_amount');
        return v === null ? null : parseFloat(String(v));
      },
    },
    refunded_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    requested_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    reviewed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    reviewed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    review_notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_returns', timestamps: true }
);
