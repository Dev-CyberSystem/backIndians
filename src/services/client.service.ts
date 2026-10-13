import { Op } from 'sequelize';
import { Client, Order, CatalogOrder, CatalogProduct, GarmentType, GarmentCost } from '../models';
import { sequelize } from '../config/db';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../utils/logger';

interface ClientInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  cuit?: string;
  notes?: string;
}

/** Estado de archivo para filtrar el listado. Por defecto solo activos. */
export type ClientStatusFilter = 'active' | 'archived' | 'all';

export async function listClients(
  page: number,
  limit: number,
  search?: string,
  status: ClientStatusFilter = 'active',
) {
  const offset = (page - 1) * limit;
  const where: Record<string | symbol, unknown> = {};
  if (search) {
    where[Op.or] = [
      { name:         { [Op.like]: `%${search}%` } },
      { email:        { [Op.like]: `%${search}%` } },
      { cuit:         { [Op.like]: `%${search}%` } },
      { contact_name: { [Op.like]: `%${search}%` } },
    ];
  }
  if (status === 'active') where.active = true;
  else if (status === 'archived') where.active = false;
  const { rows, count } = await Client.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });
  return { clients: rows, total: count, page, limit };
}

export async function getClientById(id: number): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  return client;
}

export async function createClient(input: ClientInput): Promise<Client> {
  return Client.create({
    name: input.name,
    contact_name: input.contact_name || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    cuit: input.cuit || null,
    notes: input.notes || null,
  });
}

export async function updateClient(
  id: number,
  input: Partial<ClientInput>
): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  // Lista blanca: `active`/`archived_at` solo cambian por archive/restore (admin).
  const allowed: (keyof ClientInput | 'logo_url' | 'condicion_iva')[] =
    ['name', 'contact_name', 'phone', 'email', 'address', 'cuit', 'notes', 'logo_url', 'condicion_iva'];
  const patch = Object.fromEntries(
    Object.entries(input).filter(([k]) => (allowed as string[]).includes(k)),
  );
  await client.update(patch);
  return client;
}

export interface ClientDependencies {
  /** Pedidos de producción (cualquier estado). */
  orders: number;
  /** Subconjunto de `orders` que sigue en curso (ni entregado ni cancelado). */
  open_orders: number;
  catalog_orders: number;
  catalog_products: number;
  garment_types: number;
  garment_costs: number;
  /** Total de registros asociados (`open_orders` ya está dentro de `orders`). */
  total: number;
}

/**
 * Cuenta todo lo que cuelga del cliente. Es la única fuente de verdad para
 * decidir si se puede borrar físicamente: las FK de `catalog_products` y
 * `garment_costs` son CASCADE, así que borrar sin mirar esto se llevaría el
 * catálogo y los costos versionados en silencio.
 */
export async function getClientDependencies(id: number): Promise<ClientDependencies> {
  const where = { client_id: id };
  const [orders, open_orders, catalog_orders, catalog_products, garment_types, garment_costs] =
    await Promise.all([
      Order.count({ where }),
      Order.count({ where: { ...where, status: { [Op.notIn]: ['delivered', 'cancelled'] } } }),
      CatalogOrder.count({ where }),
      CatalogProduct.count({ where }),
      GarmentType.count({ where }),
      GarmentCost.count({ where }),
    ]);
  return {
    orders, open_orders, catalog_orders, catalog_products, garment_types, garment_costs,
    total: orders + catalog_orders + catalog_products + garment_types + garment_costs,
  };
}

/** Baja lógica: oculta al cliente de listados/selectores sin tocar su historial. */
export async function archiveClient(id: number): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  if (!client.active) throw new AppError('El cliente ya está archivado', 409);
  await client.update({ active: false, archived_at: new Date() });
  logger.info('client.archived', { meta: { clientId: id, name: client.name } });
  return client;
}

export async function restoreClient(id: number): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  if (client.active) throw new AppError('El cliente ya está activo', 409);
  await client.update({ active: true, archived_at: null });
  logger.info('client.restored', { meta: { clientId: id, name: client.name } });
  return client;
}

/**
 * Borrado físico e irreversible. Solo procede si el cliente no tiene NINGÚN
 * dato asociado; si lo tiene, 409 con el detalle para que la UI lo muestre.
 */
export async function deleteClient(id: number): Promise<void> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const deps = await getClientDependencies(id);
  if (deps.total > 0) {
    throw new AppError(
      'No se puede eliminar: el cliente tiene datos asociados. Archivalo para ocultarlo conservando el historial.',
      409,
      [{ dependencies: deps }],
    );
  }

  const t = await sequelize.transaction();
  try {
    await client.destroy({ transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    // FK RESTRICT que apareció entre el conteo y el borrado.
    if ((err as { name?: string }).name === 'SequelizeForeignKeyConstraintError') {
      throw new AppError('No se puede eliminar: el cliente tiene datos asociados.', 409);
    }
    throw err;
  }
  logger.warn('client.deleted', { meta: { clientId: id, name: client.name, cuit: client.cuit } });
}
