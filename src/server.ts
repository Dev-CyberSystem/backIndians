import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { app } from './app';
import { connectDB } from './config/db';
import { initSocket } from './config/socket';
import { logger } from './utils/logger';

// Importar modelos para que Sequelize los registre y se creen las asociaciones
import './models/index';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Errores globales no manejados ────────────────────────────────────────────
// Se registran con el logger centralizado antes de (eventualmente) terminar.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason, { meta: { fatal: false } });
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err, { meta: { fatal: true } });
  // Un uncaughtException deja el proceso en estado indefinido: salir y dejar que
  // el orquestador (Railway/PM2/Docker) lo reinicie limpio.
  process.exit(1);
});

function validateEnv(): void {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.error('startup.envValidation', new Error(`Variables de entorno requeridas no configuradas: ${missing.join(', ')}`));
    process.exit(1);
  }
}

async function main() {
  validateEnv();
  try {
    // 1. Conectar a la base de datos (autentica y sincroniza en desarrollo)
    await connectDB();

    // 2. Crear servidor HTTP desde la app Express
    const httpServer = http.createServer(app);

    // 3. Inicializar Socket.io sobre el mismo servidor HTTP
    initSocket(httpServer);

    // 4. Levantar el servidor
    httpServer.listen(PORT, () => {
      logger.info('startup.ready', {
        meta: { port: PORT, socket: true, environment: process.env.NODE_ENV || 'development' },
        message: `Servidor corriendo en http://localhost:${PORT}`,
      });
    });
  } catch (error) {
    logger.error('startup.failed', error);
    process.exit(1);
  }
}

main();
