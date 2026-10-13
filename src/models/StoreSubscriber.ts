import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

/**
 * Persona que se registró en el pop-up de bienvenida (email + nombre opcional)
 * y recibió un cupón personal de un solo uso. Ver migración 110.
 */
export class StoreSubscriber extends Model<
  InferAttributes<StoreSubscriber>,
  InferCreationAttributes<StoreSubscriber>
> {
  declare id: CreationOptional<number>;
  /** Siempre en minúsculas y recortado. */
  declare email: string;
  declare name: CreationOptional<string | null>;
  declare coupon_id: CreationOptional<number | null>;
  declare source: CreationOptional<string>;
  declare consent_at: Date;
  /** Último envío del mail con el cupón (limita los reenvíos). */
  declare coupon_sent_at: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

// La unicidad de `email` vive en la migración (como `suppliers`), no acá: definirla
// también en el modelo duplica el índice bajo `sequelize.sync()`.
StoreSubscriber.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING(254), allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: true },
    coupon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    source: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'welcome_popup' },
    consent_at: { type: DataTypes.DATE, allowNull: false },
    coupon_sent_at: { type: DataTypes.DATE, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'store_subscribers', timestamps: true }
);
