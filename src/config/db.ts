import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const sharedOptions = {
  dialect: 'mysql' as const,
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  define: {
    underscored: false,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
  pool: {
    // max 4 era muy bajo: bajo picos el pool se agotaba y las requests
    // esperaban/timeouteaban (acquire), inflando aborted_connects. 10 da
    // margen sin presionar el límite de conexiones de MySQL (max ~151).
    max: 10,
    min: 0,
    acquire: 30000,
    // Cierra conexiones idle a los 10s: MUY por debajo del wait_timeout de
    // MySQL (28800s por defecto), así el pool las cierra ordenadamente antes
    // de que el server las mate → evita entregar sockets muertos.
    idle: 10000,
  },
  dialectOptions: {
    // mysql2: mantiene vivo el socket TCP para que la red interna de Railway o
    // los proxies no lo corten en silencio (causa típica de aborted_clients).
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // Timeout de establecimiento de conexión (ms). Si el server no responde,
    // falla rápido en vez de colgar el request.
    connectTimeout: 20000,
  },
};

// En Railway: MYSQL_URL contiene la URL de conexión interna (service-to-service).
// En desarrollo: usar variables DB_* individuales del .env local.
export const sequelize = process.env.MYSQL_URL
  ? new Sequelize(process.env.MYSQL_URL, sharedOptions)
  : new Sequelize({
      ...sharedOptions,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      database: process.env.DB_NAME || 'textil_db',
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    });

export async function connectDB(): Promise<void> {
  await sequelize.authenticate();
  console.log('✅ Conexión a MySQL establecida');

  if (process.env.NODE_ENV !== 'production') {
    // En desarrollo: crea tablas faltantes. En producción usar migraciones.
    // Antes de sincronizar, deduplica índices: sync() re-crea índices únicos/FK
    // en tablas con referencias cíclicas en cada arranque y puede pasar el límite
    // de MySQL de 64 índices por tabla (import dinámico para evitar ciclo).
    const { dedupeIndexes } = await import('./dedupeIndexes');
    await dedupeIndexes();
    await sequelize.sync();
    console.log('✅ Modelos sincronizados con la base de datos');
  }
}
