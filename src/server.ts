import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { app } from './app';
import { connectDB } from './config/db';
import { initSocket } from './config/socket';

// Importar modelos para que Sequelize los registre y se creen las asociaciones
import './models/index';

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PORT = parseInt(process.env.PORT || '3000', 10);

function validateEnv(): void {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Variables de entorno requeridas no configuradas: ${missing.join(', ')}`);
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
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`📡 Socket.io activo`);
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

main();
