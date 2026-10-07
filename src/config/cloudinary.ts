import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/**
 * Variante optimizada de un video para la web: ancho máx. 1280 px, calidad y
 * formato automáticos (mp4/webm según el navegador). Se usa tanto al entregar
 * como al pre-generar (`eager`) en la subida, para que coincidan.
 */
export const WEB_VIDEO_TRANSFORMATION = [
  { width: 1280, crop: 'limit' },
  { quality: 'auto', fetch_format: 'auto' },
];

/** URLs públicas de un video ya subido: variante web optimizada + portada (primer cuadro). */
export function homeVideoUrls(publicId: string): { url: string; poster_url: string } {
  return {
    url: cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      transformation: WEB_VIDEO_TRANSFORMATION,
    }),
    poster_url: cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'jpg',
      transformation: [{ width: 1280, crop: 'limit' }, { start_offset: 0 }, { quality: 'auto' }],
    }),
  };
}

// Elimina un video de Cloudinary por su public_id (resource_type distinto al de las imágenes)
export async function deleteVideo(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
}

// Elimina una imagen de Cloudinary por su public_id
export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
