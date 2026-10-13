import { Op, literal, type WhereOptions } from 'sequelize';

/**
 * Un cliente archivado (`clients.active = false`) deja de existir para la tienda
 * pública: sus productos no se listan, no se ven por id ni se pueden comprar.
 * Reversible: al reactivar al cliente vuelven solos (no se toca `show_in_store`).
 * Ver BR-CLIENT-001.
 */

/** Subconsulta para SQL crudo: `... AND client_id IN (${ACTIVE_CLIENT_IDS_SQL})`. */
export const ACTIVE_CLIENT_IDS_SQL = 'SELECT id FROM clients WHERE active = 1';

/** Condición para el `where` de `CatalogProduct` (fusionar con el resto). */
export const activeClientWhere = (): WhereOptions => ({
  client_id: { [Op.in]: literal(`(${ACTIVE_CLIENT_IDS_SQL})`) },
});
