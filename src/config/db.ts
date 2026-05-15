import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

export const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME || 'textil_db',
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
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
});

export async function connectDB(): Promise<void> {
  await sequelize.authenticate();
  console.log('✅ Conexión a MySQL establecida');

  // sync() sin alter — solo crea tablas que no existen, nunca modifica las existentes
  // Para cambios de esquema usar migraciones (migrations/)
  await sequelize.sync();
  console.log('✅ Modelos sincronizados con la base de datos');
}
