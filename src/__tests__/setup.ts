import { Settings } from '../models';

/*
 * Preparación mínima del entorno de tests, antes de cada archivo de suite.
 *
 * Desde B-02 (auditoría del 2026-08-19) el checkout rechaza un pedido por
 * transferencia si no hay CBU ni alias configurados — la defensa que faltaba
 * cuando producción ofrecía el medio de pago con los tres campos vacíos. Como
 * el pago en efectivo está desactivado, la transferencia es el medio que usan
 * casi todas las suites de tienda para llegar a crear un pedido.
 *
 * Sembrar estos valores acá y no en `npm run seed` es deliberado: el criterio
 * de aceptación es que `npx jest` corra en verde contra la base de desarrollo
 * tal como esté, sin depender de que alguien haya vuelto a sembrarla. Además
 * hay suites que pisan settings y restauran el estado previo, que puede ser
 * "la clave no existía".
 *
 * Sólo se completa lo que falta: si la base ya tiene datos bancarios cargados,
 * no se tocan.
 */

const DEFAULTS: Record<string, string> = {
  bank_transfer_cbu: '0000003100010000000001',
  bank_transfer_alias: 'INDIANS.QA.TEST',
  bank_transfer_holder: 'Indians Textil (entorno de pruebas)',
};

beforeAll(async () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const row = await Settings.findByPk(key);
    if (row && (row.value ?? '').trim()) continue;
    const now = new Date();
    await Settings.upsert({ key, value, createdAt: now, updatedAt: now });
  }
});
