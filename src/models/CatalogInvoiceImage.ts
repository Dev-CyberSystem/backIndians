import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class CatalogInvoiceImage extends Model<
  InferAttributes<CatalogInvoiceImage>,
  InferCreationAttributes<CatalogInvoiceImage>
> {
  declare id: CreationOptional<number>;
  declare catalog_invoice_id: number;
  declare url: string;
  declare cloudinary_public_id: CreationOptional<string | null>;
  declare description: CreationOptional<string | null>;
  declare uploaded_by: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogInvoiceImage.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    catalog_invoice_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    url: {
      type: DataTypes.STRING(1000),
      allowNull: false,
    },
    cloudinary_public_id: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    uploaded_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'catalog_invoice_images',
    timestamps: true,
  }
);
