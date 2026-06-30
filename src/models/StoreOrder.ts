import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';
import type { AfipStatus } from './Invoice';

export type StoreOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'review'
  | 'awaiting_courier'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type StorePaymentMethod = 'mercadopago' | 'cash' | 'bank_transfer';

export interface ShippingAddress {
  street: string;
  city: string;
  state?: string;
  zip_code?: string;
  country?: string;
}

export class StoreOrder extends Model<
  InferAttributes<StoreOrder>,
  InferCreationAttributes<StoreOrder>
> {
  declare id: CreationOptional<number>;
  declare order_number: string;
  declare customer_id: CreationOptional<number | null>;
  declare customer_name: string;
  declare customer_email: string;
  declare customer_phone: CreationOptional<string | null>;
  declare status: CreationOptional<StoreOrderStatus>;
  declare subtotal: number;
  declare discount_amount: CreationOptional<number>;
  declare shipping_cost: CreationOptional<number>;
  declare total_amount: number;
  declare shipping_type: CreationOptional<'pickup' | 'delivery'>;
  declare shipping_address: CreationOptional<ShippingAddress | null>;
  declare coupon_id: CreationOptional<number | null>;
  declare coupon_code: CreationOptional<string | null>;
  declare mp_preference_id: CreationOptional<string | null>;
  declare mp_payment_id: CreationOptional<string | null>;
  declare mp_status: CreationOptional<string | null>;
  declare tracking_number: CreationOptional<string | null>;
  declare courier_name: CreationOptional<string | null>;
  declare payment_method: CreationOptional<StorePaymentMethod>;
  declare payment_proof_url: CreationOptional<string | null>;
  declare payment_proof_url_2: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
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

type StoreOrderDecimalField = 'subtotal' | 'discount_amount' | 'shipping_cost' | 'total_amount';

const decimalGetter = (field: StoreOrderDecimalField) =>
  function (this: StoreOrder) {
    const v = this.getDataValue(field);
    return v === null || v === undefined ? v : parseFloat(String(v));
  };

StoreOrder.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    order_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    customer_name: { type: DataTypes.STRING(200), allowNull: false },
    customer_email: { type: DataTypes.STRING(255), allowNull: false },
    customer_phone: { type: DataTypes.STRING(50), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending_payment', 'paid', 'processing', 'review', 'awaiting_courier', 'shipped', 'delivered', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending_payment',
    },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, get: decimalGetter('subtotal') },
    discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, get: decimalGetter('discount_amount') },
    shipping_cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, get: decimalGetter('shipping_cost') },
    total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, get: decimalGetter('total_amount') },
    shipping_type: {
      type: DataTypes.ENUM('pickup', 'delivery'),
      allowNull: false,
      defaultValue: 'pickup',
    },
    shipping_address: { type: DataTypes.JSON, allowNull: true },
    coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    coupon_code: { type: DataTypes.STRING(50), allowNull: true },
    mp_preference_id: { type: DataTypes.STRING(255), allowNull: true },
    mp_payment_id: { type: DataTypes.STRING(255), allowNull: true },
    mp_status: { type: DataTypes.STRING(50), allowNull: true },
    tracking_number: { type: DataTypes.STRING(200), allowNull: true },
    courier_name: { type: DataTypes.STRING(200), allowNull: true },
    payment_method: {
      type: DataTypes.ENUM('mercadopago', 'cash', 'bank_transfer'),
      allowNull: false,
      defaultValue: 'mercadopago',
    },
    payment_proof_url:   { type: DataTypes.STRING(500), allowNull: true },
    payment_proof_url_2: { type: DataTypes.STRING(500), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
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
  { sequelize, tableName: 'store_orders', timestamps: true }
);
