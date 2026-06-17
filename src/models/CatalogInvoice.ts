import {
  Model, DataTypes,
  InferAttributes, InferCreationAttributes, CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type CatalogInvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export class CatalogInvoice extends Model<
  InferAttributes<CatalogInvoice>,
  InferCreationAttributes<CatalogInvoice>
> {
  declare id: CreationOptional<number>;
  declare catalog_order_id: number;
  declare invoice_number: string;
  declare issue_date: string;
  declare due_date: CreationOptional<string | null>;
  declare status: CatalogInvoiceStatus;
  declare notes: CreationOptional<string | null>;
  declare total_amount: number;
  declare payment_amount: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogInvoice.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    catalog_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    invoice_number: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    issue_date: { type: DataTypes.DATEONLY, allowNull: false },
    due_date: { type: DataTypes.DATEONLY, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM('draft', 'issued', 'paid', 'cancelled'),
      allowNull: false,
      defaultValue: 'issued',
    },
    notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      get() { return parseFloat(String(this.getDataValue('total_amount'))); },
    },
    payment_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      get() { return parseFloat(String(this.getDataValue('payment_amount'))); },
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'catalog_invoices' }
);
