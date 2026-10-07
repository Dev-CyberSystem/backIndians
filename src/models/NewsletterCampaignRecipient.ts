import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export type NewsletterRecipientStatus = 'queued' | 'sent' | 'failed' | 'skipped';

/**
 * Un destinatario de un envío de campaña. Se crean todas las filas al confirmar
 * el envío (`queued`) y el job las va despachando de a lotes, así el envío
 * sobrevive a un reinicio del proceso. Los eventos del webhook de Resend
 * (entregado, abierto, clic, rebote, spam) se cruzan por `resend_email_id`.
 *
 * El único (`campaign_id`, `subscriber_id`) vive solo en la migración 109.
 */
export class NewsletterCampaignRecipient extends Model<
  InferAttributes<NewsletterCampaignRecipient>,
  InferCreationAttributes<NewsletterCampaignRecipient>
> {
  declare id: CreationOptional<number>;
  declare campaign_id: number;
  declare subscriber_id: number;
  declare email: string;
  declare name: CreationOptional<string | null>;
  declare status: CreationOptional<NewsletterRecipientStatus>;
  declare resend_email_id: CreationOptional<string | null>;
  declare error: CreationOptional<string | null>;
  declare sent_at: CreationOptional<Date | null>;
  declare delivered_at: CreationOptional<Date | null>;
  declare opened_at: CreationOptional<Date | null>;
  declare clicked_at: CreationOptional<Date | null>;
  declare bounced_at: CreationOptional<Date | null>;
  declare complained_at: CreationOptional<Date | null>;
  declare unsubscribed_at: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

NewsletterCampaignRecipient.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    campaign_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    subscriber_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false },
    name: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM('queued', 'sent', 'failed', 'skipped'),
      allowNull: false,
      defaultValue: 'queued',
    },
    resend_email_id: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    error: { type: DataTypes.STRING(500), allowNull: true, defaultValue: null },
    sent_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    delivered_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    opened_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    clicked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    bounced_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    complained_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    unsubscribed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'newsletter_campaign_recipients', timestamps: true }
);
