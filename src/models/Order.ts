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

export class Order extends Model<
  InferAttributes<Order>,
  InferCreationAttributes<Order>
> {
  declare id: CreationOptional<number>;
  declare order_number: CreationOptional<string>;
  declare client_id: number;
  declare created_by: number;
  declare seller_id: CreationOptional<number | null>;
  declare status: CreationOptional<OrderStatus>;
  declare delivery_date: CreationOptional<Date | null>;
  declare total_amount: CreationOptional<number>;
  declare notes: CreationOptional<string | null>;
  declare workshop_notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Asociaciones (cargadas con include)
  declare client?: NonAttribute<import('./Client').Client>;
  declare creator?: NonAttribute<import('./User').User>;
  declare seller?: NonAttribute<import('./User').User>;
  declare items?: NonAttribute<import('./OrderItem').OrderItem[]>;
  declare images?: NonAttribute<import('./OrderImage').OrderImage[]>;
}

Order.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    order_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    client_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    created_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    seller_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        'pending',
        'under_review',
        'workshop_review',
        'observed',
        // Controles de producción (flujo nuevo)
        'raw_material_control',
        'cutting_control',
        'printing_control',
        'sewing_control',
        'quality_control',
        'packaging_control',
        'ready',
        'cancelled',
        // Legados (conservados para el historial)
        'in_production',
        'sewing',
        'stamping',
        'quality_check'
      ),
      allowNull: false,
      defaultValue: 'pending',
    },
    delivery_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    total_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    workshop_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'orders',
    timestamps: true,
  }
);
