import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type SupplierTaxCondition =
  | 'responsable_inscripto'
  | 'monotributo'
  | 'exento'
  | 'consumidor_final'
  | 'no_categorizado';

/**
 * Proveedor de mercadería o servicios (telas, avíos, sublimación, fletes, etc.).
 *
 * ABM autónomo: no está atado a stock, costos ni pedidos. Se administra como
 * directorio consultable con filtros. Una baja se hace lógica (`active=false`)
 * para no perder el dato; el borrado real queda restringido a admin.
 *
 * El índice único sobre `tax_id` NO se declara acá a propósito: vive solo en la
 * migración. Declararlo también en el modelo haría que `sequelize.sync()` (dev)
 * recree el índice en cada arranque hasta chocar con el límite de 64 índices de
 * MySQL (mismo patrón ya documentado en CLAUDE.md). La unicidad en dev se apoya
 * en el chequeo explícito del servicio.
 */
export class Supplier extends Model<
  InferAttributes<Supplier>,
  InferCreationAttributes<Supplier>
> {
  declare id: CreationOptional<number>;
  declare business_name: string;
  declare trade_name: CreationOptional<string | null>;
  /** Rubro / categoría libre (para clasificar y filtrar). */
  declare category: CreationOptional<string | null>;
  /** Solo dígitos (11), sin guiones. */
  declare tax_id: CreationOptional<string | null>;
  declare tax_condition: CreationOptional<SupplierTaxCondition | null>;
  declare address: CreationOptional<string | null>;
  declare province: CreationOptional<string | null>;
  declare locality: CreationOptional<string | null>;
  declare postal_code: CreationOptional<string | null>;
  declare phone: CreationOptional<string | null>;
  declare whatsapp: CreationOptional<string | null>;
  declare email: CreationOptional<string | null>;
  declare contact_person: CreationOptional<string | null>;
  declare payment_terms: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Supplier.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    business_name: { type: DataTypes.STRING(200), allowNull: false },
    trade_name: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
    category: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    tax_id: { type: DataTypes.STRING(11), allowNull: true, defaultValue: null },
    tax_condition: {
      type: DataTypes.ENUM(
        'responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_categorizado'
      ),
      allowNull: true,
      defaultValue: null,
    },
    address: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    province: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    locality: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    postal_code: { type: DataTypes.STRING(20), allowNull: true, defaultValue: null },
    phone: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
    whatsapp: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
    email: { type: DataTypes.STRING(150), allowNull: true, defaultValue: null },
    contact_person: { type: DataTypes.STRING(150), allowNull: true, defaultValue: null },
    payment_terms: { type: DataTypes.STRING(150), allowNull: true, defaultValue: null },
    notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'suppliers', timestamps: true }
);
