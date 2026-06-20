import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middlewares/auth';
import { upload } from '../middlewares/upload';
import { cloudinary } from '../config/cloudinary';
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

export default router;
