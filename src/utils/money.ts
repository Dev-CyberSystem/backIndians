/**
 * Redondeo de precios a entero (sin decimales) con la regla del negocio:
 * la parte decimal de hasta 0,50 redondea para abajo (10,50 → 10) y de 0,51
 * en adelante para arriba (10,51 → 11). Trabaja en centavos para evitar
 * errores de punto flotante. MISMA regla que el frontend (utils/formatters.ts)
 * para que lo que muestra la tienda coincida con lo que cobra el backend.
 */
export function roundPrice(value: number | string | null | undefined): number {
  // Los DECIMAL de Sequelize/MySQL pueden llegar como string (ej: "800.00"):
  // hay que coercionar antes de chequear, si no Number.isFinite("800.00") da false.
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (n == null || !Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents - whole * 100; // 0..99
  return sign * (frac <= 50 ? whole : whole + 1);
}

/** Número es-AR sin decimales, con la regla de redondeo, sin símbolo. Ej: "1.234". */
export function formatPriceNumber(value: number | string | null | undefined): string {
  return roundPrice(value).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
