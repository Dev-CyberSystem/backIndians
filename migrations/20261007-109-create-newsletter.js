'use strict';

/**
 * Newsletter / campañas de email — tres tablas nuevas e independientes.
 *
 *  - `newsletter_subscribers`: la lista de envío y la constancia del
 *    consentimiento (origen, fecha, IP, user-agent) y de la baja. Es la fuente
 *    de verdad: Resend solo entrega, no guarda la lista.
 *  - `newsletter_campaigns`: cada newsletter armada en el panel (bloques JSON),
 *    con su segmento, su estado y el HTML congelado al momento de enviarla.
 *  - `newsletter_campaign_recipients`: una fila por destinatario de cada envío.
 *    Hace el envío reanudable (el job toma las filas `queued`) y guarda el id de
 *    Resend para cruzar los eventos del webhook (entregado, abierto, rebote...).
 *
 * Los índices únicos viven SOLO acá (no en los modelos) para no repetir el caso
 * de índices duplicados bajo `sequelize.sync()` (ver CLAUDE.md).
 *
 * Migración aditiva: `up` no altera ni borra nada existente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('newsletter_subscribers')) {
      await queryInterface.createTable('newsletter_subscribers', {
        id:                       { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        email:                    { type: Sequelize.STRING(254), allowNull: false },
        name:                     { type: Sequelize.STRING(200), allowNull: true, defaultValue: null },
        // Vínculo informativo con la cuenta de la tienda (si la hay). Los
        // segmentos se calculan por email, así que no es FK obligatoria.
        store_customer_id:        { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        status: {
          type: Sequelize.ENUM('pending', 'subscribed', 'unsubscribed', 'bounced', 'complained'),
          allowNull: false,
          defaultValue: 'pending',
        },
        source: {
          type: Sequelize.ENUM('footer', 'register', 'checkout', 'account', 'admin', 'existing_customer'),
          allowNull: false,
        },
        // Hash SHA-256 del token de confirmación (doble opt-in): el token en
        // claro solo viaja en el mail.
        confirm_token_hash:       { type: Sequelize.STRING(64), allowNull: true, defaultValue: null },
        confirm_token_expires_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        confirmation_sent_at:     { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        // Token estable del link de baja (uno por suscriptor). Filtrarlo solo
        // permite dar de baja a esa dirección.
        unsubscribe_token:        { type: Sequelize.STRING(64), allowNull: false },
        subscribed_at:            { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        unsubscribed_at:          { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        unsubscribe_reason:       { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },
        consent_ip:               { type: Sequelize.STRING(64), allowNull: true, defaultValue: null },
        consent_user_agent:       { type: Sequelize.STRING(255), allowNull: true, defaultValue: null },
        createdAt:                { type: Sequelize.DATE, allowNull: false },
        updatedAt:                { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addConstraint('newsletter_subscribers', {
        fields: ['email'], type: 'unique', name: 'uq_newsletter_subscribers_email',
      });
      await queryInterface.addConstraint('newsletter_subscribers', {
        fields: ['unsubscribe_token'], type: 'unique', name: 'uq_newsletter_subscribers_unsub_token',
      });
      await queryInterface.addIndex('newsletter_subscribers', ['status'], { name: 'idx_newsletter_subscribers_status' });
      await queryInterface.addIndex('newsletter_subscribers', ['confirm_token_hash'], { name: 'idx_newsletter_subscribers_confirm' });
    }

    if (!tables.includes('newsletter_campaigns')) {
      await queryInterface.createTable('newsletter_campaigns', {
        id:                 { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:               { type: Sequelize.STRING(150), allowNull: false },
        subject:            { type: Sequelize.STRING(200), allowNull: false },
        preheader:          { type: Sequelize.STRING(200), allowNull: true, defaultValue: null },
        blocks:             { type: Sequelize.JSON, allowNull: false },
        audience: {
          type: Sequelize.ENUM('all', 'customers', 'buyers', 'non_buyers'),
          allowNull: false,
          defaultValue: 'all',
        },
        status: {
          type: Sequelize.ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled'),
          allowNull: false,
          defaultValue: 'draft',
        },
        scheduled_at:       { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        started_at:         { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        finished_at:        { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        // HTML congelado al confirmar el envío: lo que se mandó no cambia si
        // después se edita un producto o la campaña se duplica.
        html_snapshot:      { type: Sequelize.TEXT('long'), allowNull: true, defaultValue: null },
        total_recipients:   { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        created_by_user_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        updated_by_user_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        sent_by_user_id:    { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        createdAt:          { type: Sequelize.DATE, allowNull: false },
        updatedAt:          { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('newsletter_campaigns', ['status', 'scheduled_at'], { name: 'idx_newsletter_campaigns_status' });
    }

    if (!tables.includes('newsletter_campaign_recipients')) {
      await queryInterface.createTable('newsletter_campaign_recipients', {
        id:              { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        campaign_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'newsletter_campaigns', key: 'id' },
          onDelete: 'CASCADE',
        },
        subscriber_id:   { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        email:           { type: Sequelize.STRING(254), allowNull: false },
        name:            { type: Sequelize.STRING(200), allowNull: true, defaultValue: null },
        status: {
          type: Sequelize.ENUM('queued', 'sent', 'failed', 'skipped'),
          allowNull: false,
          defaultValue: 'queued',
        },
        resend_email_id: { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
        error:           { type: Sequelize.STRING(500), allowNull: true, defaultValue: null },
        sent_at:         { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        delivered_at:    { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        opened_at:       { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        clicked_at:      { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        bounced_at:      { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        complained_at:   { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        unsubscribed_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
        createdAt:       { type: Sequelize.DATE, allowNull: false },
        updatedAt:       { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addConstraint('newsletter_campaign_recipients', {
        fields: ['campaign_id', 'subscriber_id'], type: 'unique', name: 'uq_newsletter_recipients_campaign_subscriber',
      });
      await queryInterface.addIndex('newsletter_campaign_recipients', ['campaign_id', 'status'], { name: 'idx_newsletter_recipients_status' });
      await queryInterface.addIndex('newsletter_campaign_recipients', ['resend_email_id'], { name: 'idx_newsletter_recipients_resend_id' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('newsletter_campaign_recipients');
    await queryInterface.dropTable('newsletter_campaigns');
    await queryInterface.dropTable('newsletter_subscribers');
  },
};
