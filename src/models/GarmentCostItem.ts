import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type CostCategory = 'jersey' | 'shorts';

/**
 * Maestro configurable de ítems de costo por categoría de prenda. Las dos listas
 * (jersey / shorts) se siembran por migración. `group_key` agrupa ítems
 * excluyentes/condicionales solo para la UI; ningún ítem es obligatorio.
 */
export class GarmentCostItem extends Model<
  InferAttributes<GarmentCostItem>,
  InferCreationAttributes<GarmentCostItem>
> {
  declare id: CreationOptional<number>;
  declare category: CostCategory;
  declare key: string;
  declare label: string;
  declare group_key: CreationOptional<string | null>;
  declare sort_order: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

GarmentCostItem.init(
  {
    id:         { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    category:   { type: DataTypes.ENUM('jersey', 'shorts'), allowNull: false },
    key:        { type: DataTypes.STRING(60), allowNull: false },
    label:      { type: DataTypes.STRING(150), allowNull: false },
    group_key:  { type: DataTypes.STRING(40), allowNull: true, defaultValue: null },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    active:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt:  DataTypes.DATE,
    updatedAt:  DataTypes.DATE,
  },
  { sequelize, tableName: 'garment_cost_items', timestamps: true }
);
