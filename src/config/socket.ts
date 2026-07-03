import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { JwtPayload } from '../types';

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

  // ── Autenticación: solo usuarios del sistema con JWT válido ─────────────────
  // Los eventos que se emiten (pedidos, pagos, facturas) contienen datos de
  // clientes (nombres, emails, totales). La tienda pública NO usa socket.io
  // (recibe cambios por SSE), así que exigimos un token de sistema válido para
  // conectarse y evitar que terceros escuchen esa información.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('No autenticado'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
      (socket.data as { user?: JwtPayload }).user = payload;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user?: JwtPayload }).user;
    console.log(`🔌 Cliente conectado: ${socket.id} (usuario ${user?.id ?? '?'})`);

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
