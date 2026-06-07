import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type CatalogOrderStatus = 'created' | 'invoice_created' | 'delivered';
export type PaymentType = 'full' | 'half';

export class CatalogOrder extends Model<
  InferAttributes<CatalogOrder>,
  InferCreationAttributes<CatalogOrder>
> {
  declare id: CreationOptional<number>;
  declare order_number: string;
  declare client_id: CreationOptional<number | null>;
  declare seller_id: number;
  declare status: CreationOptional<CatalogOrderStatus>;
  declare payment_type: CreationOptional<PaymentType>;
  declare total_amount: number;
  declare payment_amount: number;
  declare mp_preference_id: CreationOptional<string | null>;
  declare mp_payment_id: CreationOptional<string | null>;
  declare mp_payment_status: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogOrder.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    order_number: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
    },
    client_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    seller_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('created', 'invoice_created', 'delivered'),
      allowNull: false,
      defaultValue: 'created',
    },
    payment_type: {
      type: DataTypes.ENUM('full', 'half'),
      allowNull: false,
      defaultValue: 'full',
    },
    total_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('total_amount');
        return v === null ? null : parseFloat(String(v));
      },
    },
    payment_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('payment_amount');
        return v === null ? null : parseFloat(String(v));
      },
    },
    mp_preference_id: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    mp_payment_id: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    mp_payment_status: {
      type: DataTypes.STRING(50),
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
    tableName: 'catalog_orders',
    timestamps: true,
  }
);
