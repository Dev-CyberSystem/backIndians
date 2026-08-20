import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { app } from './app';
import { connectDB } from './config/db';
import { initSocket } from './config/socket';
import { logger } from './utils/logger';
import { ensureGarmentCostItems } from './services/cost.service';
import { ensureSchema, ensureLegalSchema } from './config/ensureSchema';
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
  // La rebaja temporal del 2026-08-07 (DEC-014) queda cerrada: `MP_WEBHOOK_SECRET`
  // se cargó en Railway y el arranque del 2026-08-19 18:02 GMT-3 ya no logueó
  // `startup.envValidation.temporary`, así que el chequeo vuelve a ser fatal.
  //
  // Por qué fatal y no un warning: sin el secreto, `verifyWebhookSignature`
  // rechaza TODAS las notificaciones de MercadoPago (fail-closed real en
  // `mercadopago.service.ts:22`). El sistema no queda inseguro, queda mudo — los
  // pagos sólo se acreditan por el job de conciliación, con hasta ~10 minutos de
  // demora, y nada lo grita. Un arranque que falla es ruidoso e inmediato; un
  // warning en un log que nadie mira fue justamente lo que dejó esto abierto
  // doce días.
  //
  // ⚠️ La contracara es real y ya pasó: activar esta validación sin la variable
  // cargada dejó producción en crash-loop más de un día (2026-08-06T17:53 →
  // 2026-08-07). Antes de tocar esta lista, confirmá que la variable está en el
  // proceso que corre — `/health` ahora expone `webhook_secret` justamente para
  // eso, y `npm run prod` lo muestra.
  if (process.env.NODE_ENV === 'production') {
    const prodErrors: string[] = [];

    const backendUrl = process.env.BACKEND_PUBLIC_URL || '';
    if (!backendUrl || /localhost|127\.0\.0\.1/.test(backendUrl)) {
      prodErrors.push('BACKEND_PUBLIC_URL falta o apunta a localhost (requerido para el webhook de MercadoPago)');
    }

    if (!process.env.MP_WEBHOOK_SECRET) {
      prodErrors.push(
        'MP_WEBHOOK_SECRET falta — sin él se rechazan todas las notificaciones de MercadoPago y los ' +
        'pagos sólo se acreditan por el job de conciliación (hasta ~10 min de demora). ' +
        'Cargalo en Railway con el mismo valor que figura en la configuración del webhook en MercadoPago.'
      );
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
    //     (dev usa sync() y no altera tablas ya creadas).
    //
    //     SOLO fuera de producción (A-01 de la auditoría del 2026-08-19). Las
    //     dos funciones hacen DDL real —addColumn, removeIndex, addIndex,
    //     changeColumn, ALTER de ENUM—, así que sin esta guarda cada reinicio
    //     del contenedor productivo podía alterar el esquema sin dejar rastro
    //     en SequelizeMeta. Producción usa migraciones formales (`npm run
    //     migrate` corre en el startCommand); todo lo que estas funciones
    //     parchean tiene su migración: 059, 063, 065, 066, 069, 091-095 y 098.
    //     `config/db.ts` ya tenía la guarda equivalente para sync() — acá se
    //     había replicado el patrón sin la guarda en vez de corregirlo.
    if (process.env.NODE_ENV !== 'production') {
      await ensureSchema();
      await ensureLegalSchema();
    }

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
