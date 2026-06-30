import {
  Model, DataTypes,
  InferAttributes, InferCreationAttributes, CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';
import type { AfipStatus } from './Invoice';

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
  { sequelize, tableName: 'catalog_invoices' }
);
