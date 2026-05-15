import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';
import { InvoiceStatus } from '../types';

export interface InvoiceExtraItem {
  description: string;
  amount: number;
}

export class Invoice extends Model<
  InferAttributes<Invoice>,
  InferCreationAttributes<Invoice>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;
  declare invoice_number: string;
  declare issue_date: Date;
  declare due_date: CreationOptional<Date | null>;
  declare status: CreationOptional<InvoiceStatus>;
  declare notes: CreationOptional<string | null>;
  declare discount_amount: CreationOptional<number>;
  declare extra_items: CreationOptional<InvoiceExtraItem[] | null>;
  declare total_amount: CreationOptional<number | null>;
  declare pdf_url: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare order?: NonAttribute<import('./Order').Order>;
}

Invoice.init(
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
    invoice_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'issued', 'paid', 'cancelled'),
      allowNull: false,
      defaultValue: 'draft',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    discount_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    extra_items: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    pdf_url: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'invoices',
    timestamps: true,
  }
);
