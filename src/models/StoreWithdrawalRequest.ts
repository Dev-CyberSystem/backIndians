import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export type WithdrawalStatus = 'received' | 'in_progress' | 'resolved' | 'rejected';

/**
 * Solicitud de arrepentimiento (Resolución 424/2020 SCI + art. 34 Ley 24.240
 * + arts. 1110/1111 CCyCN).
 *
 * La resolución exige que el consumidor pueda pedir la revocación SIN
 * registrarse ni hacer ningún trámite previo, y que dentro de las 24 h se le
 * informe un código de identificación del arrepentimiento. Por eso:
 *   - la tabla no depende de `store_customers` (el que se arrepiente puede
 *     haber comprado como invitado);
 *   - `code` se genera en el mismo request y se devuelve/manda por mail al
 *     instante (no se espera a que un humano lo procese);
 *   - `store_order_id` se completa solo si el número de pedido informado
 *     coincide con un pedido real — nunca se rechaza la solicitud por no
 *     encontrarlo, porque eso sería ponerle un trámite previo.
 */
export class StoreWithdrawalRequest extends Model<
  InferAttributes<StoreWithdrawalRequest>,
  InferCreationAttributes<StoreWithdrawalRequest>
> {
  declare id: CreationOptional<number>;
  /** Código informado al consumidor (ARR-AAAA-NNNNNN). Único. */
  declare code: string;
  declare order_number: CreationOptional<string | null>;
  declare store_order_id: CreationOptional<number | null>;
  declare customer_id: CreationOptional<number | null>;
  declare customer_name: string;
  declare customer_email: string;
  declare customer_phone: CreationOptional<string | null>;
  declare reason: CreationOptional<string | null>;
  declare status: CreationOptional<WithdrawalStatus>;
  declare admin_notes: CreationOptional<string | null>;
  declare resolved_by: CreationOptional<number | null>;
  declare resolved_at: CreationOptional<Date | null>;
  declare ip: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StoreWithdrawalRequest.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(24), allowNull: false, unique: true },
    order_number: { type: DataTypes.STRING(60), allowNull: true, defaultValue: null },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    customer_name: { type: DataTypes.STRING(120), allowNull: false },
    customer_email: { type: DataTypes.STRING(255), allowNull: false },
    customer_phone: { type: DataTypes.STRING(40), allowNull: true, defaultValue: null },
    reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM('received', 'in_progress', 'resolved', 'rejected'),
      allowNull: false,
      defaultValue: 'received',
    },
    admin_notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    resolved_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    resolved_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    ip: { type: DataTypes.STRING(45), allowNull: true, defaultValue: null },
    user_agent: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_withdrawal_requests', timestamps: true }
);
