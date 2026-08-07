// Genera un número de factura único basado en fecha y un sufijo aleatorio
export function generateInvoiceNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `FC-${year}${month}-${rand}`;
}

// Parsea un número de página de la query, con fallback a 1
export function parsePage(value: unknown, fallback = 1): number {
  const n = parseInt(value as string, 10);
  return isNaN(n) || n < 1 ? fallback : n;
}

// Parsea un límite de la query, con mínimo 1 y máximo configurable
export function parseLimit(value: unknown, max = 100, fallback = 20): number {
  const n = parseInt(value as string, 10);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Zona horaria operativa del negocio. */
export const BUSINESS_TIMEZONE = 'America/Argentina/Tucuman';

/**
 * Fecha de negocio (`YYYY-MM-DD`) en la zona horaria del negocio.
 *
 * Reemplaza a `new Date().toISOString().slice(0, 10)`, que devuelve la fecha
 * **UTC**: como Tucumán es UTC−3, todo lo registrado entre las 21:00 y la
 * medianoche local quedaba fechado al día siguiente. En caja eso corre un
 * movimiento (o el contraasiento de una reversión) a la jornada equivocada y
 * descuadra el resumen diario y cualquier corte por fecha.
 *
 * `en-CA` se usa porque su formato corto ya es ISO (`2026-08-07`); no depende
 * de la zona horaria del servidor (Railway corre en UTC, la máquina de
 * desarrollo no).
 */
export function businessDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
