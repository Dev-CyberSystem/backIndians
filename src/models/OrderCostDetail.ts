import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

/**
 * Detalle de costos "congelado" de un pedido: una fila por ítem del pedido con
 * el costo unitario (costo final de la prenda del cliente) vigente al momento de
 * cargarlo. Referencia la versión inmutable usada, así cambios de costos futuros
 * no alteran el pedido.
 */
export class OrderCostDetail extends Model<
  InferAttributes<OrderCostDetail>,
  InferCreationAttributes<OrderCostDetail>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;
  declare order_item_id: CreationOptional<number | null>;
  declare garment_type_id: CreationOptional<number | null>;
  declare garment_type_name: CreationOptional<string | null>;
  declare garment_cost_id: CreationOptional<number | null>;
  declare garment_cost_version_id: CreationOptional<number | null>;
  declare quantity: CreationOptional<number>;
  declare unit_cost: CreationOptional<number>;
  declare line_total: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

const money = (field: 'unit_cost' | 'line_total') => ({
  type: DataTypes.DECIMAL(12, 2),
  allowNull: false,
  defaultValue: 0,
  get(this: OrderCostDetail) {
    const v = this.getDataValue(field);
    return v === null ? 0 : parseFloat(String(v));
  },
});

OrderCostDetail.init(
  {
    id:                      { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    order_id:                { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    order_item_id:           { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    garment_type_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    garment_type_name:       { type: DataTypes.STRING(150), allowNull: true, defaultValue: null },
    garment_cost_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    garment_cost_version_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    quantity:                { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    unit_cost:               money('unit_cost'),
    line_total:              money('line_total'),
    createdAt:               DataTypes.DATE,
    updatedAt:               DataTypes.DATE,
  },
  { sequelize, tableName: 'order_cost_details', timestamps: true }
);
