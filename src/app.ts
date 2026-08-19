import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { errorHandler } from './middlewares/errorHandler';
import { requestContext } from './middlewares/requestContext';
import { generalLimiter } from './middlewares/rateLimit';
import { router as apiRouter } from './routes/index';
import { sequelize } from './config/db';
import { APP_VERSION, APP_COMMIT } from './config/version';
import { logger } from './utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const app = express();

// Detrás del proxy de Railway/Nginx: confía en 1 salto para que req.ip sea la IP
// real del cliente (necesario para que el rate-limit cuente por cliente, no por
// proxy). Valor numérico — no `true` — para no permitir spoofing de X-Forwarded-For.
app.set('trust proxy', 1);

// ─── Seguridad y cabeceras ────────────────────────────────────────────────────
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`[CORS] Origen bloqueado: ${origin} — permitidos: ${allowedOrigins.join(', ')}`);
      callback(new Error(`CORS: origen no permitido: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // 'Idempotency-Key' faltaba acá desde siempre: el checkout de la tienda
    // (1.4) y ahora el cobro de facturas (Fase 2 de caja, DEC-012) la envían
    // desde el frontend, pero el preflight CORS la rechazaba — "Request
    // header field idempotency-key is not allowed by
    // Access-Control-Allow-Headers" — así que en un navegador real la
    // request ni siquiera salía. Nunca se detectó porque los tests de API
    // (supertest) no pasan por CORS del navegador; recién lo mostró un E2E
    // real contra Chromium (Fase 3 del plan de GO).
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ─── Parseo de cuerpo ────────────────────────────────────────────────────────
// 1mb alcanza de sobra para cualquier JSON legítimo de la app (las imágenes van
// por multipart/multer, no por JSON). Reduce la superficie de DoS por body grande.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Contexto de transacción + logger por request ─────────────────────────────
app.use(requestContext);

// ─── Rutas ───────────────────────────────────────────────────────────────────
// Backstop anti-DoS por IP para toda la API (las rutas sensibles tienen su propio
// límite, más estricto). Se desactiva bajo test/carga con RATE_LIMIT_DISABLED=1.
app.use('/api/v1', generalLimiter, apiRouter);

/**
 * Health check — lo consume el watchdog externo que avisa si el sistema se cae
 * (condición C7 de la auditoría de preproducción).
 *
 * Verifica la BASE, no sólo que el proceso esté vivo: antes respondía
 * `{status:'ok'}` sin tocar MySQL, así que si la base se caía y Node seguía en
 * pie el monitor veía verde mientras el sistema estaba inutilizable. Un health
 * check que no puede fallar no sirve para monitorear nada.
 *
 * Devuelve **503** cuando la base no responde, que es lo que cualquier monitor
 * externo (UptimeRobot y similares) interpreta como caída.
 *
 * `SELECT 1` con timeout corto: la idea es detectar "la base no contesta", no
 * medir su rendimiento; sin timeout, un pool agotado dejaría la request colgada
 * hasta que el monitor corte por su cuenta y el motivo real se pierda.
 */
app.get('/health', async (_req, res) => {
  const started = Date.now();
  try {
    await Promise.race([
      sequelize.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout de 5s consultando la base')), 5_000)
      ),
    ]);
    res.json({
      success: true,
      data: {
        status: 'ok',
        database: 'ok',
        version: APP_VERSION,
        commit: APP_COMMIT,
        uptime_seconds: Math.round(process.uptime()),
        response_ms: Date.now() - started,
      },
    });
  } catch (err) {
    logger.error('health.databaseUnreachable', err);
    res.status(503).json({
      success: false,
      data: {
        status: 'error',
        database: 'unreachable',
        version: APP_VERSION,
        commit: APP_COMMIT,
        uptime_seconds: Math.round(process.uptime()),
        response_ms: Date.now() - started,
      },
      message: 'La base de datos no responde',
    });
  }
});

// ─── Manejo de errores (debe ir al final) ────────────────────────────────────
app.use(errorHandler);

export { app };
