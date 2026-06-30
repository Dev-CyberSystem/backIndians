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

export type AfipStatus = 'pending' | 'sent' | 'error';

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
  declare payment_amount: CreationOptional<number | null>;
  declare pdf_url: CreationOptional<string | null>;
  declare afip_status: CreationOptional<AfipStatus | null>;
  declare afip_tipo_comprobante: CreationOptional<number | null>;
  declare afip_concepto: CreationOptional<number | null>;
  declare afip_iva_alicuota: CreationOptional<number | null>;
  declare afip_doc_tipo: CreationOptional<number | null>;
  declare afip_condicion_iva_receptor: CreationOptional<number | null>;
  declare afip_punto_venta: CreationOptional<number | null>;
  declare afip_cbte_nro: CreationOptional<number | null>;
  declare afip_cae: CreationOptional<string | null>;
  declare afip_cae_vto: CreationOptional<string | null>;
  declare afip_sent_at: CreationOptional<Date | null>;
  declare afip_error: CreationOptional<string | null>;
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
    payment_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
    pdf_url: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    afip_status:                 { type: DataTypes.ENUM('pending', 'sent', 'error'), allowNull: true },
    afip_tipo_comprobante:       { type: DataTypes.TINYINT.UNSIGNED,                 allowNull: true },
    afip_concepto:               { type: DataTypes.TINYINT.UNSIGNED,                 allowNull: true },
    afip_iva_alicuota:           { type: DataTypes.DECIMAL(5, 2),                    allowNull: true, get() { const v = this.getDataValue('afip_iva_alicuota'); return v === null || v === undefined ? null : parseFloat(String(v)); } },
    afip_doc_tipo:               { type: DataTypes.TINYINT.UNSIGNED,                 allowNull: true },
    afip_condicion_iva_receptor: { type: DataTypes.TINYINT.UNSIGNED,                 allowNull: true },
    afip_punto_venta:            { type: DataTypes.SMALLINT.UNSIGNED,                allowNull: true },
    afip_cbte_nro:               { type: DataTypes.INTEGER.UNSIGNED,                 allowNull: true },
    afip_cae:                    { type: DataTypes.STRING(20),                       allowNull: true },
    afip_cae_vto:                { type: DataTypes.DATEONLY,                         allowNull: true },
    afip_sent_at:                { type: DataTypes.DATE,                             allowNull: true },
    afip_error:                  { type: DataTypes.TEXT,                             allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'invoices',
    timestamps: true,
  }
);
