import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';
import { StoreOrderStatus } from './StoreOrder';

const STATUS_VALUES: StoreOrderStatus[] = [
  'pending_payment', 'paid', 'processing', 'review', 'awaiting_courier',
  'shipped', 'delivered', 'cancelled', 'delayed', 'returned',
];

/**
 * Traza inmutable de cada cambio de estado de un pedido de la tienda. Nunca se
 * pisa: cada transición agrega una fila (estado anterior, nuevo, quién y cuándo).
 */
export class StoreOrderStatusHistory extends Model<
  InferAttributes<StoreOrderStatusHistory>,
  InferCreationAttributes<StoreOrderStatusHistory>
> {
  declare id: CreationOptional<number>;
  declare store_order_id: number;
  declare previous_status: CreationOptional<StoreOrderStatus | null>;
  declare new_status: StoreOrderStatus;
  declare note: CreationOptional<string | null>;
  /** Admin/billing que hizo el cambio. NULL = cambio automático del sistema. */
  declare changed_by: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare changer?: NonAttribute<import('./User').User>;
}

StoreOrderStatusHistory.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    previous_status: { type: DataTypes.ENUM(...STATUS_VALUES), allowNull: true },
    new_status: { type: DataTypes.ENUM(...STATUS_VALUES), allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    changed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_order_status_history', timestamps: true }
);
