/**
 * Diagnóstico de integridad del módulo de caja — SOLO LECTURA.
 *
 * Pensado para correrse antes de un despliegue (y después, como smoke test)
 * contra la base que se va a migrar. No escribe nada: son consultas `SELECT`.
 * Cada bloque devuelve las filas anómalas; lo esperado es 0 en todas.
 *
 *   npx ts-node --project tsconfig.seed.json scripts/cash-integrity-check.ts
 */

import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/config/db';

type Check = { id: string; description: string; sql: string; expectZero: boolean };

const CHECKS: Check[] = [
  {
    id: 'CT-01',
    description: 'Movimientos cuya cuenta no existe (FK huérfana)',
    sql: `SELECT ct.id, ct.account_id FROM cash_transactions ct
          LEFT JOIN cash_accounts a ON a.id = ct.account_id
          WHERE a.id IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-02',
    description: 'Movimientos cuya categoría no existe (FK huérfana)',
    sql: `SELECT ct.id, ct.category_id FROM cash_transactions ct
          LEFT JOIN cash_transaction_categories c ON c.id = ct.category_id
          WHERE c.id IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-03',
    description: 'Importes nulos, cero o negativos (el signo lo da `type`, nunca el importe)',
    sql: `SELECT id, amount, type FROM cash_transactions WHERE amount IS NULL OR amount <= 0`,
    expectZero: true,
  },
  {
    id: 'CT-04',
    description: 'Transferencias sin cuenta destino, o con destino igual al origen',
    sql: `SELECT id, account_id, transfer_account_id FROM cash_transactions
          WHERE type = 'transfer' AND (transfer_account_id IS NULL OR transfer_account_id = account_id)`,
    expectZero: true,
  },
  {
    id: 'CT-05',
    description: 'Movimientos NO transferencia con cuenta destino cargada',
    sql: `SELECT id, type, transfer_account_id FROM cash_transactions
          WHERE type <> 'transfer' AND transfer_account_id IS NOT NULL AND reversal_of_id IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-06',
    description: 'Contraasientos que revierten más de lo que valía el original (sobre-reversión)',
    sql: `SELECT o.id, o.amount AS original, SUM(r.amount) AS revertido
          FROM cash_transactions o
          JOIN cash_transactions r ON r.reversal_of_id = o.id
          GROUP BY o.id, o.amount
          HAVING SUM(r.amount) > o.amount + 0.001`,
    expectZero: true,
  },
  {
    id: 'CT-07',
    description: 'Movimientos marcados `reversed` sin ningún contraasiento que lo respalde',
    sql: `SELECT o.id FROM cash_transactions o
          LEFT JOIN cash_transactions r ON r.reversal_of_id = o.id
          WHERE o.status = 'reversed' AND r.id IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-08',
    description: 'Movimientos totalmente revertidos que siguen marcados `active`',
    sql: `SELECT o.id, o.amount, SUM(r.amount) AS revertido
          FROM cash_transactions o
          JOIN cash_transactions r ON r.reversal_of_id = o.id
          WHERE o.status = 'active'
          GROUP BY o.id, o.amount
          HAVING SUM(r.amount) >= o.amount - 0.001`,
    expectZero: true,
  },
  {
    id: 'CT-09',
    description: 'Contraasientos de un contraasiento (una reversión no se revierte)',
    sql: `SELECT r.id, r.reversal_of_id FROM cash_transactions r
          JOIN cash_transactions p ON p.id = r.reversal_of_id
          WHERE p.reversal_of_id IS NOT NULL`,
    expectZero: true,
  },
  {
    id: 'CT-10',
    description: 'Claves de idempotencia duplicadas (el índice único debería impedirlo)',
    sql: `SELECT idempotency_key, COUNT(*) AS n FROM cash_transactions
          WHERE idempotency_key IS NOT NULL
          GROUP BY idempotency_key HAVING COUNT(*) > 1`,
    expectZero: true,
  },
  {
    id: 'CT-11',
    description: 'Pedidos de tienda con más de un asiento de ingreso (doble contabilización)',
    sql: `SELECT reference_id, COUNT(*) AS n FROM cash_transactions
          WHERE reference_type = 'store_order' AND reversal_of_id IS NULL AND type = 'income'
          GROUP BY reference_id HAVING COUNT(*) > 1`,
    expectZero: true,
  },
  {
    id: 'CT-12',
    description: 'Pedidos con `cash_recorded_at` marcado pero sin asiento de caja',
    sql: `SELECT o.id, o.order_number, o.cash_recorded_at FROM store_orders o
          LEFT JOIN cash_transactions ct
            ON ct.reference_type = 'store_order' AND ct.reference_id = o.id AND ct.reversal_of_id IS NULL
          WHERE o.cash_recorded_at IS NOT NULL AND ct.id IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-13',
    description: 'Asientos de tienda sin la marca `cash_recorded_at` en el pedido',
    sql: `SELECT ct.id, ct.reference_id FROM cash_transactions ct
          JOIN store_orders o ON o.id = ct.reference_id
          WHERE ct.reference_type = 'store_order' AND ct.reversal_of_id IS NULL
            AND o.cash_recorded_at IS NULL`,
    expectZero: true,
  },
  {
    id: 'CT-14',
    description: 'Pedidos cancelados con ingreso de caja todavía sin revertir',
    sql: `SELECT o.id, o.order_number, ct.id AS tx_id, ct.amount FROM store_orders o
          JOIN cash_transactions ct
            ON ct.reference_type = 'store_order' AND ct.reference_id = o.id AND ct.reversal_of_id IS NULL
          WHERE o.status = 'cancelled' AND ct.status = 'active'`,
    expectZero: true,
  },
  {
    id: 'CT-15',
    description: 'Movimientos en una categoría de tipo incompatible (CASH-VAL-005 histórico)',
    sql: `SELECT ct.id, ct.type, c.type AS category_type, c.name FROM cash_transactions ct
          JOIN cash_transaction_categories c ON c.id = ct.category_id
          WHERE ct.type <> 'transfer' AND ct.reversal_of_id IS NULL
            AND c.type <> 'both' AND c.type <> ct.type`,
    expectZero: false, // informativo: puede haber datos previos a la validación
  },
  {
    id: 'CT-16',
    description: 'Cuentas desactivadas que todavía tienen saldo (informativo, deben verse en el resumen)',
    sql: `SELECT id, name, current_balance FROM cash_accounts WHERE active = 0 AND current_balance <> 0`,
    expectZero: false,
  },
  {
    id: 'CT-17',
    description: 'Cuentas con saldo negativo (informativo: puede ser legítimo en una cuenta bancaria)',
    sql: `SELECT id, name, type, current_balance FROM cash_accounts WHERE current_balance < 0`,
    expectZero: false,
  },
  {
    id: 'CT-18',
    description: 'Movimientos sin usuario responsable',
    sql: `SELECT ct.id FROM cash_transactions ct
          LEFT JOIN users u ON u.id = ct.created_by
          WHERE u.id IS NULL`,
    expectZero: true,
  },
];

/**
 * Recalcula el saldo de cada cuenta desde el libro de movimientos y lo compara
 * con `current_balance`. Es la prueba de fondo: si el saldo persistido no
 * coincide con la suma de los asientos, hubo una escritura fuera del ledger.
 */
const BALANCE_SQL = `
  SELECT
    a.id, a.name, a.active, a.current_balance,
    COALESCE((
      SELECT SUM(CASE
        WHEN ct.type = 'income'   THEN  ct.amount
        WHEN ct.type = 'expense'  THEN -ct.amount
        WHEN ct.type = 'transfer' THEN -ct.amount
      END) FROM cash_transactions ct WHERE ct.account_id = a.id
    ), 0)
    + COALESCE((
      SELECT SUM(ct.amount) FROM cash_transactions ct
      WHERE ct.transfer_account_id = a.id AND ct.type = 'transfer'
    ), 0) AS calculado
  FROM cash_accounts a
  ORDER BY a.id`;

async function main() {
  await sequelize.authenticate();
  const db = sequelize.getDatabaseName?.() ?? '(desconocida)';
  console.log(`\n=== Diagnóstico de integridad de caja — base: ${db} ===\n`);

  let blocking = 0;

  for (const check of CHECKS) {
    const rows = await sequelize.query(check.sql, { type: QueryTypes.SELECT });
    const flag = rows.length === 0 ? 'OK  ' : check.expectZero ? 'FALLA' : 'INFO ';
    if (rows.length > 0 && check.expectZero) blocking++;
    console.log(`[${flag}] ${check.id} — ${check.description}: ${rows.length} fila(s)`);
    if (rows.length > 0) console.log(`        ${JSON.stringify(rows.slice(0, 10))}`);
  }

  console.log('\n--- Saldo persistido vs. recalculado desde el libro ---');
  const balances = await sequelize.query<{
    id: number; name: string; active: number; current_balance: string; calculado: string;
  }>(BALANCE_SQL, { type: QueryTypes.SELECT });

  let mismatches = 0;
  for (const b of balances) {
    const stored = Number(b.current_balance);
    const computed = Number(b.calculado);
    const diff = Number((stored - computed).toFixed(2));
    if (Math.abs(diff) > 0.005) {
      mismatches++;
      console.log(`[FALLA] cuenta ${b.id} "${b.name}": persistido ${stored} vs. recalculado ${computed} (diferencia ${diff})`);
    }
  }
  if (mismatches === 0) console.log(`[OK  ] las ${balances.length} cuentas cuadran con su libro de movimientos`);
  blocking += mismatches;

  console.log(`\n=== ${blocking === 0 ? 'Sin anomalías bloqueantes' : `${blocking} anomalía(s) BLOQUEANTE(S)`} ===\n`);
  await sequelize.close();
  process.exit(blocking === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Error ejecutando el diagnóstico:', err);
  process.exit(2);
});
