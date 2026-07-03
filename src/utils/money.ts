/**
 * Redondeo de precios a entero (sin decimales) con la regla del negocio:
 * la parte decimal de hasta 0,50 redondea para abajo (10,50 → 10) y de 0,51
 * en adelante para arriba (10,51 → 11). Trabaja en centavos para evitar
 * errores de punto flotante. MISMA regla que el frontend (utils/formatters.ts)
 * para que lo que muestra la tienda coincida con lo que cobra el backend.
 */
export function roundPrice(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents - whole * 100; // 0..99
  return sign * (frac <= 50 ? whole : whole + 1);
}

/** Número es-AR sin decimales, con la regla de redondeo, sin símbolo. Ej: "1.234". */
export function formatPriceNumber(value: number | null | undefined): string {
  return roundPrice(value).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
