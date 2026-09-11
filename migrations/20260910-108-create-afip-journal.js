'use strict';
module.exports = {
  async up(qi, S) {
    await qi.createTable('afip_documents', {
      id: { type: S.STRING(100), primaryKey: true },
      target: { type: S.STRING(20), allowNull: false },
      target_id: { type: S.INTEGER.UNSIGNED, allowNull: false },
      environment: { type: S.STRING(4), allowNull: false },
      stream: { type: S.STRING(64), allowNull: false },
      status: { type: S.STRING(12), allowNull: false },
      snapshot: { type: S.JSON, allowNull: false },
      response: { type: S.JSON, allowNull: true },
      error: { type: S.TEXT, allowNull: true },
      createdAt: { type: S.DATE, allowNull: false },
      updatedAt: { type: S.DATE, allowNull: false },
    });
    await qi.addIndex('afip_documents', ['stream', 'status'], { name: 'afip_stream_status' });
    await qi.addIndex('afip_documents', ['target', 'target_id'], { name: 'afip_target' });
    await qi.createTable('afip_auth_tickets', {
      id: { type: S.STRING(64), primaryKey: true },
      encrypted: { type: S.TEXT, allowNull: false },
      expires_at: { type: S.DATE, allowNull: false },
      createdAt: { type: S.DATE, allowNull: false },
      updatedAt: { type: S.DATE, allowNull: false },
    });
  },
  async down(qi) {
    // No ejecutar con comprobantes reales: el journal es parte del registro fiscal.
    await qi.dropTable('afip_auth_tickets');
    await qi.dropTable('afip_documents');
  },
};
