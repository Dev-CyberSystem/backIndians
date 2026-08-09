import { sequelize } from '../src/config/db';
import { QueryTypes } from 'sequelize';

/**
 * Datos de SISTEMA: filas que la aplicación necesita para funcionar y que no
 * son "datos de ejemplo".
 *
 * ─── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Estas filas las crean MIGRACIONES de datos (085, 095, 034/036/038…). Eso
 * alcanza en producción, donde las migraciones corren una vez y nadie borra la
 * base. Pero en desarrollo se usa `sequelize.sync()` y las migraciones no se
 * re-ejecutan: si alguien vacía la base —o clona el repo y siembra desde
 * cero— esas filas no vuelven, y la aplicación queda rota de una forma nada
 * obvia.
 *
 * Se descubrió el 2026-08-09 al limpiar la base de desarrollo: 22 tests
 * empezaron a fallar con `Falta la categoría "Ventas tienda online"
 * (migración 085)`. El pedido pagado no podía generar su asiento en caja.
 *
 * Es idempotente: sólo inserta lo que falta, así que se puede correr siempre.
 * NO reemplaza a las migraciones — en producción manda la migración.
 */

/** Categorías de caja marcadas como de sistema, que el código busca por nombre. */
const SYSTEM_CASH_CATEGORIES: Array<{ name: string; type: string; color: string }> = [
  // Migración 085 — la usa `recordStoreOrderIncome` al acreditarse un pedido.
  { name: 'Ventas tienda online', type: 'income', color: '#7C3AED' },
  // Migración 095 — la usa `recordInvoiceCollectionCashIncome` al cobrar una factura.
  { name: 'Cobranzas de facturas', type: 'income', color: '#0EA5E9' },
];

export async function seedSystemData(): Promise<void> {
  let creadas = 0;

  for (const cat of SYSTEM_CASH_CATEGORIES) {
    const existing = await sequelize.query<{ id: number }>(
      'SELECT id FROM cash_transaction_categories WHERE name = ? LIMIT 1',
      { replacements: [cat.name], type: QueryTypes.SELECT }
    );
    if (existing.length > 0) continue;

    const now = new Date();
    await sequelize.query(
      `INSERT INTO cash_transaction_categories (name, type, color, is_system, active, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, 1, ?, ?)`,
      { replacements: [cat.name, cat.type, cat.color, now, now] }
    );
    creadas++;
    console.log(`  ✅ Categoría de sistema creada: ${cat.name}`);
  }

  console.log(
    creadas === 0
      ? '🎉 Datos de sistema: ya estaban todos'
      : `🎉 Datos de sistema: ${creadas} creado(s)`
  );
}

// Permite correrlo suelto: `ts-node seeders/system-data.ts`
if (require.main === module) {
  seedSystemData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error sembrando datos de sistema:', err);
      process.exit(1);
    });
}
