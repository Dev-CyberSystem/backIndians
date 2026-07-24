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
 * Hoja de costos vigente de una prenda de un cliente (par cliente + tipo de
 * prenda, único). `total_cost` y `current_version_id` cachean la última versión;
 * el historial completo vive en garment_cost_versions.
 */
export class GarmentCost extends Model<
  InferAttributes<GarmentCost>,
  InferCreationAttributes<GarmentCost>
> {
  declare id: CreationOptional<number>;
  declare client_id: number;
  declare garment_type_id: number;
  declare total_cost: CreationOptional<number>;
  declare current_version_id: CreationOptional<number | null>;
  declare updated_by: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare garmentType?: NonAttribute<import('./GarmentType').GarmentType>;
  declare client?: NonAttribute<import('./Client').Client>;
  declare current_version?: NonAttribute<import('./GarmentCostVersion').GarmentCostVersion>;
}

GarmentCost.init(
  {
    id:                 { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    client_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    garment_type_id:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    total_cost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('total_cost');
        return v === null ? 0 : parseFloat(String(v));
      },
    },
    current_version_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    updated_by:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt:          DataTypes.DATE,
    updatedAt:          DataTypes.DATE,
  },
  { sequelize, tableName: 'garment_costs', timestamps: true }
);
