import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';
import type { NewsletterBlock } from '../utils/newsletterRender';

export type NewsletterAudience = 'all' | 'customers' | 'buyers' | 'non_buyers';
export type NewsletterCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';

/**
 * Campaña de newsletter armada en el panel. El contenido son bloques (ver
 * `utils/newsletterRender.ts`); al confirmar el envío se congela el HTML en
 * `html_snapshot` y se arma la lista de destinatarios.
 */
export class NewsletterCampaign extends Model<
  InferAttributes<NewsletterCampaign>,
  InferCreationAttributes<NewsletterCampaign>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare subject: string;
  declare preheader: CreationOptional<string | null>;
  declare blocks: NewsletterBlock[];
  declare audience: CreationOptional<NewsletterAudience>;
  declare status: CreationOptional<NewsletterCampaignStatus>;
  declare scheduled_at: CreationOptional<Date | null>;
  declare started_at: CreationOptional<Date | null>;
  declare finished_at: CreationOptional<Date | null>;
  declare html_snapshot: CreationOptional<string | null>;
  declare total_recipients: CreationOptional<number>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare sent_by_user_id: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

NewsletterCampaign.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    subject: { type: DataTypes.STRING(200), allowNull: false },
    preheader: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
    blocks: {
      type: DataTypes.JSON,
      allowNull: false,
      // MariaDB guarda JSON como LONGTEXT y mysql2 lo devuelve como string:
      // se normaliza para que el resto del código siempre vea un array.
      get() {
        const raw = this.getDataValue('blocks') as unknown;
        if (typeof raw === 'string') {
          try { return JSON.parse(raw) as NewsletterBlock[]; } catch { return []; }
        }
        return (raw as NewsletterBlock[]) ?? [];
      },
    },
    audience: {
      type: DataTypes.ENUM('all', 'customers', 'buyers', 'non_buyers'),
      allowNull: false,
      defaultValue: 'all',
    },
    status: {
      type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled'),
      allowNull: false,
      defaultValue: 'draft',
    },
    scheduled_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    started_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    finished_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    html_snapshot: { type: DataTypes.TEXT('long'), allowNull: true, defaultValue: null },
    total_recipients: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    sent_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'newsletter_campaigns', timestamps: true }
);
