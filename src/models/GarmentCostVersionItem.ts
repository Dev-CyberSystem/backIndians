import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

/**
 * Ítem de una versión de costos (snapshot). Denormaliza `item_key`/`item_label`
 * para que el historial se lea igual aunque el maestro cambie o se desactive.
 */
export class GarmentCostVersionItem extends Model<
  InferAttributes<GarmentCostVersionItem>,
  InferCreationAttributes<GarmentCostVersionItem>
> {
  declare id: CreationOptional<number>;
  declare version_id: number;
  declare cost_item_id: CreationOptional<number | null>;
  declare item_key: string;
  declare item_label: string;
  declare amount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

GarmentCostVersionItem.init(
  {
    id:           { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    version_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    cost_item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    item_key:     { type: DataTypes.STRING(60), allowNull: false },
    item_label:   { type: DataTypes.STRING(150), allowNull: false },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('amount');
        return v === null ? 0 : parseFloat(String(v));
      },
    },
    createdAt:    DataTypes.DATE,
    updatedAt:    DataTypes.DATE,
  },
  { sequelize, tableName: 'garment_cost_version_items', timestamps: true }
);
