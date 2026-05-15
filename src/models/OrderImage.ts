import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class OrderImage extends Model<
  InferAttributes<OrderImage>,
  InferCreationAttributes<OrderImage>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;
  declare url: string;
  declare cloudinary_public_id: string;
  declare description: CreationOptional<string | null>;
  declare uploaded_by: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

OrderImage.init(
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
    url: {
      type: DataTypes.STRING(1000),
      allowNull: false,
    },
    cloudinary_public_id: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    uploaded_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'order_images',
    timestamps: true,
  }
);
