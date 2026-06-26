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
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ─── Parseo de cuerpo ────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Contexto de transacción + logger por request ─────────────────────────────
app.use(requestContext);

// ─── Rutas ───────────────────────────────────────────────────────────────────
// Backstop anti-DoS por IP para toda la API (las rutas sensibles tienen su propio
// límite, más estricto). Se desactiva bajo test/carga con RATE_LIMIT_DISABLED=1.
app.use('/api/v1', generalLimiter, apiRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

// ─── Manejo de errores (debe ir al final) ────────────────────────────────────
app.use(errorHandler);

export { app };
