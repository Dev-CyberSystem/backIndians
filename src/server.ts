import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { app } from './app';
import { connectDB } from './config/db';
import { initSocket } from './config/socket';
import { logger } from './utils/logger';
import { ensureGarmentCostItems } from './services/cost.service';
import { ensureSchema } from './config/ensureSchema';
import { startScheduledJobs } from './jobs/scheduler';

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

  // En producción, el webhook de MercadoPago necesita una URL pública real para
  // que MP pueda notificar pagos, y un secreto para validar la firma de esas
  // notificaciones. Sin esto, los pagos no se acreditan solos (C-2) o el webhook
  // queda abierto a cualquiera (C-3). Fallar acá es más barato que descubrirlo
  // con pedidos pagados que nunca pasan a "paid".
  if (process.env.NODE_ENV === 'production') {
    const backendUrl = process.env.BACKEND_PUBLIC_URL || '';
    const prodErrors: string[] = [];
    if (!backendUrl || /localhost|127\.0\.0\.1/.test(backendUrl)) {
      prodErrors.push('BACKEND_PUBLIC_URL falta o apunta a localhost (requerido para el webhook de MercadoPago)');
    }
    if (!process.env.MP_WEBHOOK_SECRET) {
      prodErrors.push('MP_WEBHOOK_SECRET no está configurado (requerido para validar la firma del webhook de MercadoPago)');
    }
    if (prodErrors.length) {
      logger.error('startup.envValidation', new Error(prodErrors.join(' | ')));
      process.exit(1);
    }
  }
}

async function main() {
  validateEnv();
  try {
    // 1. Conectar a la base de datos (autentica y sincroniza en desarrollo)
    await connectDB();

    // 1a. Asegurar columnas que agregan las migraciones sobre tablas existentes
    //     (dev usa sync() y no altera tablas ya creadas)
    await ensureSchema();

    // 1b. Sembrar el maestro de ítems de costo (idempotente; necesario en dev
    //     donde se usa sync() en lugar de migraciones)
    await ensureGarmentCostItems();

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

    // 5. Jobs programados (reconciliación de pagos + inconsistencias diarias)
    startScheduledJobs();
  } catch (error) {
    logger.error('startup.failed', error);
    process.exit(1);
  }
}

main();
