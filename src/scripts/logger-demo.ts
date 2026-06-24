/**
 * Demo del sistema de logging estructurado.
 *
 *   Formato NDJSON (producción):   NODE_ENV=production npx ts-node src/scripts/logger-demo.ts
 *   Formato legible (desarrollo):  npx ts-node src/scripts/logger-demo.ts
 *
 * Muestra: contexto base inmutable con child(), sanitización automática
 * (password → [REDACTED], cuentas → ****1234) y los dos casos típicos:
 * un error de negocio y un error inesperado de sistema.
 */
import { logger } from '../utils/logger';
import { AppError } from '../middlewares/errorHandler';

// Contexto base de la transacción (se hereda en cada log emitido por este hijo).
const txLogger = logger.child({
  transactionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  operator: { id: 'op_001', name: 'Juan Pérez', role: 'teller', sessionId: 'sess_abc123' },
  meta: { correlationId: 'corr_xyz987' },
});

// ─── Caso 1: error de negocio (regla de dominio) ───────────────────────────────
function ejemploErrorDeNegocio(): void {
  const inicio = Date.now();
  try {
    // ...lógica que detecta que no hay fondos...
    throw new AppError('Fondos insuficientes para realizar la transferencia', 422, undefined, {
      code: 'INSUFFICIENT_FUNDS',
      type: 'BusinessRuleError',
    });
  } catch (err) {
    txLogger.error('processTransfer', err, {
      customer: { id: 'cust_789', name: 'María González', accountNumber: '1234567890124521' },
      request: {
        method: 'POST',
        url: '/api/v1/transfers',
        payload: {
          amount: 50000,
          currency: 'ARS',
          destinationAccount: '9876543210009874',
          // Estos NO deben aparecer en el log: la sanitización los limpia.
          password: 'super-secreta',
          cvv: '123',
        },
      },
      meta: { correlationId: 'corr_xyz987', duration: Date.now() - inicio },
    });
  }
}

// ─── Caso 2: error inesperado de sistema (excepción no prevista) ───────────────
async function ejemploErrorDeSistema(): Promise<void> {
  const inicio = Date.now();
  try {
    // Simula una falla técnica inesperada (timeout de DB, null pointer, etc.)
    const cuenta: { saldo: number } | null = null;
    // @ts-expect-error: acceso intencional a null para generar un TypeError real
    return cuenta.saldo;
  } catch (err) {
    // Lo wrapeamos para conservar el error original en el log.
    const wrapped = new AppError('No se pudo obtener el saldo de la cuenta', 500, undefined, {
      code: 'BALANCE_FETCH_FAILED',
      type: 'SystemError',
      originalError: err,
    });
    txLogger.error('getUserBalance', wrapped, {
      customer: { id: 'cust_789', name: 'María González', accountNumber: '1234567890124521' },
      request: { method: 'GET', url: '/api/v1/accounts/cust_789/balance' },
      meta: { correlationId: 'corr_xyz987', duration: Date.now() - inicio, retryCount: 3 },
    });
  }
}

async function run() {
  txLogger.info('demo.start', { message: 'Iniciando demo de logging' });
  ejemploErrorDeNegocio();
  await ejemploErrorDeSistema();
  // Un WARN simple para mostrar el nivel.
  txLogger.warn('rateLimit.near', { message: 'Cliente cerca del límite de requests', meta: { used: 95, limit: 100 } });
}

run();
