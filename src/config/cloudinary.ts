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
 * Transformación de entrada (se aplica UNA vez, al subir): el original que queda
 * guardado nunca supera 2560 px de lado. Las fotos de celular (4000+ px) y los
 * artes exportados en alta pesaban varios MB y se entregaban así. Ningún lugar
 * de la tienda o del panel muestra más de 2560 px de ancho.
 */
export const UPLOAD_IMAGE_LIMIT = { width: 2560, height: 2560, crop: 'limit' } as const;

/**
 * URL de entrega optimizada de una imagen subida: formato y calidad automáticos
 * (AVIF/WebP según el navegador). El 98 % del consumo de Cloudinary del ciclo
 * 18/09–17/10/2026 fue ancho de banda de imágenes servidas con la URL cruda del
 * original. El frontend además agrega el ancho según dónde se muestra
 * (`frontIndians/src/utils/cloudinary.ts`, que reconoce esta forma).
 */
export function webImageUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    secure: true,
    transformation: [{ fetch_format: 'auto', quality: 'auto' }],
  });
}

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
