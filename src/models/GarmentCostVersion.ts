import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';

/**
 * Versión inmutable de la hoja de costos de una prenda. Cada guardado/edición
 * crea una versión nueva (version_number incremental) — nunca se pisa.
 */
export class GarmentCostVersion extends Model<
  InferAttributes<GarmentCostVersion>,
  InferCreationAttributes<GarmentCostVersion>
> {
  declare id: CreationOptional<number>;
  declare garment_cost_id: number;
  declare version_number: number;
  declare total_cost: CreationOptional<number>;
  declare created_by: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare items?: NonAttribute<import('./GarmentCostVersionItem').GarmentCostVersionItem[]>;
  declare creator?: NonAttribute<import('./User').User>;
}

GarmentCostVersion.init(
  {
    id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    garment_cost_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    version_number:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    total_cost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('total_cost');
        return v === null ? 0 : parseFloat(String(v));
      },
    },
    created_by:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt:       DataTypes.DATE,
    updatedAt:       DataTypes.DATE,
  },
  { sequelize, tableName: 'garment_cost_versions', timestamps: true }
);
