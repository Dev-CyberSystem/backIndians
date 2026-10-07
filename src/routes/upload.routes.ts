import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { upload, uploadVideo } from '../middlewares/upload';
import { cloudinary, WEB_VIDEO_TRANSFORMATION, homeVideoUrls } from '../config/cloudinary';
import type { AuthRequest } from '../types';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
        return;
      }

      const folder = typeof req.body.folder === 'string' ? req.body.folder : 'indians/misc';

      const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image' },
          (err, res) => {
            if (err || !res) return reject(err || new Error('Upload fallido'));
            resolve({ secure_url: res.secure_url, public_id: res.public_id });
          }
        ).end(req.file!.buffer);
      });

      res.status(201).json({ success: true, data: { url: result.secure_url, public_id: result.public_id } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /upload/video — video del bloque de la página principal de la tienda.
 *
 * A diferencia de `POST /upload` (cualquier usuario del sistema, solo imágenes),
 * acá solo `admin`/`billing`: es contenido que se publica en el inicio.
 * Devuelve la URL ya optimizada para la web, una portada tomada del primer
 * cuadro y el public_id (para poder borrar el video cuando se reemplaza).
 */
router.post(
  '/video',
  authorize('admin', 'billing'),
  uploadVideo.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
        return;
      }

      // upload_large_stream sube en partes: un video de decenas de MB no entra bien en una sola request.
      const result = await new Promise<{ public_id: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_large_stream(
          {
            folder: 'indians/home-video',
            resource_type: 'video',
            chunk_size: 6 * 1024 * 1024,
            // Pre-genera la variante web para que el primer visitante no espere la transcodificación.
            eager: [{ transformation: WEB_VIDEO_TRANSFORMATION }],
            eager_async: true,
          },
          (err, out) => {
            if (err || !out) return reject(err || new Error('Upload fallido'));
            resolve({ public_id: out.public_id });
          }
        );
        stream.end(req.file!.buffer);
      });

      const { url, poster_url } = homeVideoUrls(result.public_id);

      res.status(201).json({ success: true, data: { url, poster_url, public_id: result.public_id } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
