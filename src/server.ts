import http from 'http';
import dotenv from 'dotenv';
import { app } from './app';
import { connectDB } from './config/db';
import { initSocket } from './config/socket';

// Importar modelos para que Sequelize los registre y se creen las asociaciones
import './models/index';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
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
