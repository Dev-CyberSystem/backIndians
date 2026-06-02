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
    max: 4,
    min: 0,
    acquire: 30000,
    idle: 10000,
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
    await sequelize.sync();
    console.log('✅ Modelos sincronizados con la base de datos');
  }
}
