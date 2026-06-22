import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class CatalogProduct extends Model<
  InferAttributes<CatalogProduct>,
  InferCreationAttributes<CatalogProduct>
> {
  declare id: CreationOptional<number>;
  declare client_id: number;
  declare title: string;
  declare description: CreationOptional<string | null>;
  declare price: number;
  declare stock_quantity: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare public_price: CreationOptional<number | null>;
  declare discount_percentage: CreationOptional<number>;
  declare show_in_store: CreationOptional<boolean>;
  declare category: CreationOptional<string | null>;
  declare gender: CreationOptional<'masculino' | 'femenino' | 'infantil' | 'unisex' | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogProduct.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    client_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('price');
        return v === null ? null : parseFloat(String(v));
      },
    },
    stock_quantity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    public_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get() {
        const v = this.getDataValue('public_price');
        return v === null ? null : parseFloat(String(v));
      },
    },
    discount_percentage: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    show_in_store: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    gender: {
      type: DataTypes.ENUM('masculino', 'femenino', 'infantil', 'unisex'),
      allowNull: true,
      defaultValue: null,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'catalog_products',
    timestamps: true,
  }
);
