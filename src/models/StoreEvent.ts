import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class StoreEvent extends Model<InferAttributes<StoreEvent>, InferCreationAttributes<StoreEvent>> {
  declare id: CreationOptional<number>;
  declare session_id: string;
  declare customer_id: CreationOptional<number | null>;
  declare event_type: 'product_view' | 'cart_add' | 'cart_remove' | 'search' | 'purchase' | 'checkout_start';
  declare product_id: CreationOptional<number | null>;
  declare search_query: CreationOptional<string | null>;
  declare device_type: CreationOptional<'mobile' | 'tablet' | 'desktop'>;
  declare country_code: CreationOptional<string | null>;
  declare region: CreationOptional<string | null>;
  declare city: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreEvent.init({
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  session_id: { type: DataTypes.STRING(64), allowNull: false },
  customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
  event_type: {
    type: DataTypes.ENUM('product_view', 'cart_add', 'cart_remove', 'search', 'purchase', 'checkout_start'),
    allowNull: false,
  },
  product_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
  search_query: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
  device_type: {
    type: DataTypes.ENUM('mobile', 'tablet', 'desktop'),
    allowNull: false,
    defaultValue: 'desktop',
  },
  country_code: { type: DataTypes.STRING(2), allowNull: true, defaultValue: null },
  region: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
  city: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, {
  sequelize,
  tableName: 'store_events',
  timestamps: true,
  indexes: [
    { fields: ['event_type'] },
    { fields: ['product_id'] },
    { fields: ['session_id'] },
    { fields: ['city'] },
    { fields: ['createdAt'] },
  ],
});
