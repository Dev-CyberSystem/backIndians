import { randomInt } from 'crypto';

/**
 * Cupón de bienvenida del pop-up de registro (brief 06.10.2026, pedido 03).
 * Piezas puras (sin DB ni red), testeables.
 */

/** Sin caracteres ambiguos (0/O, 1/I/L): el código se lee y se tipea a mano. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const WELCOME_CODE_PREFIX = 'BIENVENIDA-';
const CODE_SUFFIX_LENGTH = 6;

/** Código personal difícil de adivinar: `BIENVENIDA-K7M2QX` (≈ 887 millones de combinaciones). */
export function generateWelcomeCode(): string {
  let suffix = '';
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
    suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${WELCOME_CODE_PREFIX}${suffix}`;
}

/** Misma normalización que el resto del sistema: minúsculas y sin espacios (no se quitan puntos de Gmail). */
export function normalizeSubscriberEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─── Configuración (editable desde el panel; vigencia/usos "por definir" con Indians) ───

export const WELCOME_SETTING_KEYS = [
  'store_welcome_popup_enabled',
  'store_welcome_discount_percent',
  'store_welcome_valid_days',
] as const;

export interface WelcomeConfig {
  enabled: boolean;
  /** Porcentaje de descuento, entero 1–100. */
  percent: number;
  /** Días de vigencia desde el registro, entero 1–365. */
  validDays: number;
}

export const WELCOME_DEFAULTS = { percent: 10, validDays: 30 } as const;

const toIntInRange = (raw: string | undefined, min: number, max: number, fallback: number): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Convierte las filas de `settings` en configuración válida (valores rotos → defaults). */
export function parseWelcomeConfig(values: Record<string, string | undefined>): WelcomeConfig {
  return {
    // Apagado por defecto: hasta que Indians confirme las condiciones no se publica solo.
    enabled: values.store_welcome_popup_enabled === 'true',
    percent: toIntInRange(values.store_welcome_discount_percent, 1, 100, WELCOME_DEFAULTS.percent),
    validDays: toIntInRange(values.store_welcome_valid_days, 1, 365, WELCOME_DEFAULTS.validDays),
  };
}

export function welcomeExpiry(from: Date, validDays: number): Date {
  return new Date(from.getTime() + validDays * 24 * 60 * 60 * 1000);
}

/** Mínimo entre reenvíos del mail con el cupón al mismo email (evita usar el form para bombardear una casilla). */
export const RESEND_COOLDOWN_MS = 60 * 60 * 1000;

export function canResendCoupon(lastSentAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= RESEND_COOLDOWN_MS;
}

// ─── CSV ───────────────────────────────────────────────────────────────────────

/**
 * Celda CSV segura: comillas escapadas y, si empieza con =, +, -, @ o tab,
 * se antepone un apóstrofe para que Excel/Sheets no lo ejecuten como fórmula
 * (el nombre lo escribe cualquier visitante).
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
