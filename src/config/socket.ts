import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

let io: SocketServer;

export function initSocket(httpServer: HttpServer): SocketServer {
  // FRONTEND_URL puede ser una lista separada por comas (dominio raíz de la
  // tienda + subdominio del sistema). La spliteamos igual que el CORS HTTP.
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  io = new SocketServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id}`);

    // El cliente solicita unirse a un room (ej: 'orders', 'notifications')
    socket.on('join', (room: string) => {
      socket.join(room);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Cliente desconectado: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.io no inicializado');
  return io;
}
