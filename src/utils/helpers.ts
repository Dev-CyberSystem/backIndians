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
