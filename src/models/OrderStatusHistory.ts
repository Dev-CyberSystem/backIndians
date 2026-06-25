import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';
import { OrderStatus } from '../types';

export class OrderStatusHistory extends Model<
  InferAttributes<OrderStatusHistory>,
  InferCreationAttributes<OrderStatusHistory>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;
  declare previous_status: CreationOptional<OrderStatus | null>;
  declare new_status: OrderStatus;
  declare comment: CreationOptional<string | null>;
  declare changed_by: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare changer?: NonAttribute<import('./User').User>;
}

OrderStatusHistory.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    previous_status: {
      type: DataTypes.ENUM(
        'pending',
        'under_review',
        'workshop_review',
        'observed',
        'raw_material_control',
        'cutting_control',
        'printing_control',
        'sewing_control',
        'quality_control',
        'packaging_control',
        'ready',
        'cancelled',
        'in_production',
        'sewing',
        'stamping',
        'quality_check'
      ),
      allowNull: true,
    },
    new_status: {
      type: DataTypes.ENUM(
        'pending',
        'under_review',
        'workshop_review',
        'observed',
        'raw_material_control',
        'cutting_control',
        'printing_control',
        'sewing_control',
        'quality_control',
        'packaging_control',
        'ready',
        'cancelled',
        'in_production',
        'sewing',
        'stamping',
        'quality_check'
      ),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    changed_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'order_status_history',
    timestamps: true,
  }
);
