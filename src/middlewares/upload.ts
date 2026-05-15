import multer from 'multer';
import { AppError } from './errorHandler';
import { Request } from 'express';

// Multer en memoria; Cloudinary se encarga del almacenamiento
const storage = multer.memoryStorage();

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Tipo de archivo no permitido. Solo se aceptan imágenes (JPEG, PNG, WEBP, GIF)', 400));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB por archivo
    files: 10,
  },
});
