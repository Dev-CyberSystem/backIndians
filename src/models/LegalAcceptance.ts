import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';
import type { LegalDocumentKey } from '../config/legalDocs';

/** Contexto en el que el comprador aceptó (para poder reconstruir el flujo). */
export type LegalAcceptanceContext = 'register' | 'google_register' | 'checkout';

/**
 * Constancia de aceptación de un documento legal (Términos y Condiciones o
 * Política de Privacidad).
 *
 * Es un registro append-only: nunca se actualiza ni se borra una fila: cada
 * aceptación es un hecho fechado. Guarda IP y user-agent porque, ante un
 * reclamo de Defensa del Consumidor, la constancia útil es "esta persona,
 * desde este dispositivo, aceptó esta versión de este texto, este día".
 *
 * `customer_id` y `store_order_id` son ambos opcionales a propósito:
 *   - registro de cuenta → customer_id, sin pedido todavía;
 *   - checkout de invitado → store_order_id + email, sin cuenta;
 *   - checkout logueado → los dos.
 */
export class LegalAcceptance extends Model<
  InferAttributes<LegalAcceptance>,
  InferCreationAttributes<LegalAcceptance>
> {
  declare id: CreationOptional<number>;
  declare document: LegalDocumentKey;
  declare version: string;
  declare customer_id: CreationOptional<number | null>;
  declare store_order_id: CreationOptional<number | null>;
  declare email: CreationOptional<string | null>;
  declare context: LegalAcceptanceContext;
  declare ip: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare accepted_at: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

LegalAcceptance.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    document: { type: DataTypes.ENUM('terms', 'privacy'), allowNull: false },
    version: { type: DataTypes.STRING(20), allowNull: false },
    customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    store_order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    email: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    context: {
      type: DataTypes.ENUM('register', 'google_register', 'checkout'),
      allowNull: false,
    },
    // 45 caracteres: alcanza para IPv6 (incluido el formato IPv4-mapeado).
    ip: { type: DataTypes.STRING(45), allowNull: true, defaultValue: null },
    user_agent: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    accepted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'legal_acceptances', timestamps: true }
);
