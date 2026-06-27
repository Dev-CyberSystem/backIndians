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
 * Tilde de un ítem del checklist de un control de producción. Una fila por ítem
 * tildado; al destildar se elimina la fila. `createdAt` = momento del tilde y
 * `checked_by` = quién lo tildó (auditoría por ítem).
 */
export class OrderChecklistCheck extends Model<
  InferAttributes<OrderChecklistCheck>,
  InferCreationAttributes<OrderChecklistCheck>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;
  declare status: string;     // el control al que pertenece (ej 'cutting_control')
  declare item_key: string;   // clave del ítem dentro del control
  declare checked_by: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare checker?: NonAttribute<import('./User').User>;
}

OrderChecklistCheck.init(
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
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    item_key: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    checked_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'order_checklist_checks',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['order_id', 'status', 'item_key'] },
    ],
  }
);
