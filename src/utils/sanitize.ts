/**
 * Sanitización de payloads antes de loguear. Nunca deben quedar en los logs:
 * contraseñas, tokens, cookies, CVV/PIN ni números de cuenta/tarjeta completos.
 *
 * - Claves "secretas" → se reemplazan por '[REDACTED]'.
 * - Claves "identificadoras" (cuenta, tarjeta, CBU…) → se enmascaran dejando los
 *   últimos 4 caracteres (ej: '****4521').
 * - Es recursiva, evita ciclos y limita la profundidad.
 */

const REDACT = '[REDACTED]';

// Coincidencia por subcadena (clave normalizada a minúsculas y sin separadores).
const REDACT_SUBSTRINGS = [
  'password', 'passwd', 'contrasen', 'secret', 'token', 'authorization',
  'cookie', 'apikey', 'accesskey', 'secretkey', 'privatekey', 'clientsecret',
  'cvv', 'cvc', 'passwordhash', 'refreshtoken', 'accesstoken', 'sessiontoken',
];
// Claves cortas y ambiguas: solo coincidencia exacta para evitar falsos positivos.
const REDACT_EXACT = ['pwd', 'pin', 'auth', 'jwt'];

const MASK_SUBSTRINGS = [
  'cardnumber', 'accountnumber', 'destinationaccount', 'creditcard',
  'debitcard', 'cbu', 'iban', 'cuentadestino',
];
const MASK_EXACT = ['card', 'account', 'pan', 'tarjeta', 'cuenta'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function shouldRedact(key: string): boolean {
  const k = normalizeKey(key);
  return REDACT_EXACT.includes(k) || REDACT_SUBSTRINGS.some((s) => k.includes(s));
}

function shouldMask(key: string): boolean {
  const k = normalizeKey(key);
  return MASK_EXACT.includes(k) || MASK_SUBSTRINGS.some((s) => k.includes(s));
}

/** Enmascara dejando los últimos 4 caracteres visibles. */
export function maskTail(value: unknown): string {
  const s = String(value);
  const visible = s.slice(-4);
  return `****${visible}`;
}

export interface SanitizeOptions {
  maxDepth?: number;
  /** Trunca strings más largas que este límite (0 = sin límite). */
  maxStringLength?: number;
}

export function sanitize<T = unknown>(input: T, options: SanitizeOptions = {}): T {
  const maxDepth = options.maxDepth ?? 8;
  const maxStringLength = options.maxStringLength ?? 2000;
  const seen = new WeakSet<object>();

  function walk(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      return maxStringLength > 0 && value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}…[+${value.length - maxStringLength} chars]`
        : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (typeof value === 'function') return '[Function]';

    if (depth >= maxDepth) return '[Truncated: max depth]';

    if (Array.isArray(value)) {
      return value.map((v) => walk(v, depth + 1));
    }

    if (typeof value === 'object') {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);

      // Errores: no recursar en propiedades internas, dejar algo legible.
      if (value instanceof Error) {
        return { name: value.name, message: value.message };
      }

      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (shouldRedact(key)) {
          out[key] = REDACT;
        } else if (shouldMask(key) && val != null && typeof val !== 'object') {
          out[key] = maskTail(val);
        } else {
          out[key] = walk(val, depth + 1);
        }
      }
      return out;
    }

    return value;
  }

  return walk(input, 0) as T;
}
