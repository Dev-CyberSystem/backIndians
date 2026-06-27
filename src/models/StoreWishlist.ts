import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class StoreWishlist extends Model<
  InferAttributes<StoreWishlist>,
  InferCreationAttributes<StoreWishlist>
> {
  declare customer_id: number;
  declare catalog_product_id: number;
  declare created_at: CreationOptional<Date>;
}

StoreWishlist.init(
  {
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    catalog_product_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'store_wishlist',
    timestamps: false,
  }
);
