import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type NewsletterSubscriberStatus =
  | 'pending'       // pidió suscribirse, falta confirmar (doble opt-in)
  | 'subscribed'    // recibe campañas
  | 'unsubscribed'  // se dio de baja (link, one-click, "Mis datos" o admin)
  | 'bounced'       // rebote permanente informado por Resend: no se vuelve a usar
  | 'complained';   // lo marcó como spam: no se vuelve a usar

export type NewsletterSubscriberSource =
  | 'footer'
  | 'register'
  | 'checkout'
  | 'account'
  | 'admin'
  | 'existing_customer';

/**
 * Suscriptor de la newsletter de la tienda — y constancia de su consentimiento.
 *
 * Los índices únicos (`email`, `unsubscribe_token`) viven SOLO en la migración
 * 109: declararlos acá los duplicaría bajo `sequelize.sync()` (ver CLAUDE.md).
 * En dev la unicidad se apoya en el chequeo explícito del servicio.
 */
export class NewsletterSubscriber extends Model<
  InferAttributes<NewsletterSubscriber>,
  InferCreationAttributes<NewsletterSubscriber>
> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare name: CreationOptional<string | null>;
  declare store_customer_id: CreationOptional<number | null>;
  declare status: CreationOptional<NewsletterSubscriberStatus>;
  declare source: NewsletterSubscriberSource;
  declare confirm_token_hash: CreationOptional<string | null>;
  declare confirm_token_expires_at: CreationOptional<Date | null>;
  declare confirmation_sent_at: CreationOptional<Date | null>;
  declare unsubscribe_token: string;
  declare subscribed_at: CreationOptional<Date | null>;
  declare unsubscribed_at: CreationOptional<Date | null>;
  declare unsubscribe_reason: CreationOptional<string | null>;
  declare consent_ip: CreationOptional<string | null>;
  declare consent_user_agent: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

NewsletterSubscriber.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING(254), allowNull: false },
    name: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
    store_customer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM('pending', 'subscribed', 'unsubscribed', 'bounced', 'complained'),
      allowNull: false,
      defaultValue: 'pending',
    },
    source: {
      type: DataTypes.ENUM('footer', 'register', 'checkout', 'account', 'admin', 'existing_customer'),
      allowNull: false,
    },
    confirm_token_hash: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    confirm_token_expires_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    confirmation_sent_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    unsubscribe_token: { type: DataTypes.STRING(64), allowNull: false },
    subscribed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    unsubscribed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    unsubscribe_reason: { type: DataTypes.STRING(30), allowNull: true, defaultValue: null },
    consent_ip: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    consent_user_agent: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'newsletter_subscribers', timestamps: true }
);
