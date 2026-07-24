import { GarmentType, FabricType, SizeChart } from '../models';
import { AppError } from '../middlewares/errorHandler';

// ─── Tipos comunes para las tablas maestras ────────────────────────────────

interface MasterItemInput {
  name: string;
  active?: boolean;
  sort_order?: number;
}

// ─── GarmentType ──────────────────────────────────────────────────────────────

export async function listGarmentTypes(onlyActive = true, clientId?: number) {
  const where: Record<string, unknown> = {};
  if (onlyActive) where.active = true;
  // Filtra estrictamente por cliente (los globales/legado quedan fuera).
  if (clientId !== undefined) where.client_id = clientId;
  return GarmentType.findAll({
    where,
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
}

export async function createGarmentType(
  input: MasterItemInput & { client_id?: number | null }
): Promise<GarmentType> {
  return GarmentType.create({
    name: input.name,
    client_id: input.client_id ?? null,
    active: input.active ?? true,
    sort_order: input.sort_order ?? 0,
  });
}

export async function updateGarmentType(
  id: number,
  input: Partial<MasterItemInput>
): Promise<GarmentType> {
  const item = await GarmentType.findByPk(id);
  if (!item) throw new AppError('Tipo de prenda no encontrado', 404);
  await item.update(input);
  return item;
}

/**
 * Asigna la categoría de costo de un tipo de prenda (jersey/shorts o null).
 * Endpoint aparte para permitirlo a admin y billing (la edición general de
 * tipos de prenda queda solo para admin).
 */
export async function setGarmentCostCategory(
  id: number,
  cost_category: 'jersey' | 'shorts' | null
): Promise<GarmentType> {
  const item = await GarmentType.findByPk(id);
  if (!item) throw new AppError('Tipo de prenda no encontrado', 404);
  await item.update({ cost_category });
  return item;
}

// ─── FabricType ───────────────────────────────────────────────────────────────

export async function listFabricTypes(onlyActive = true) {
  return FabricType.findAll({
    where: onlyActive ? { active: true } : {},
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
}

export async function createFabricType(input: MasterItemInput): Promise<FabricType> {
  return FabricType.create({
    name: input.name,
    active: input.active ?? true,
    sort_order: input.sort_order ?? 0,
  });
}

export async function updateFabricType(
  id: number,
  input: Partial<MasterItemInput>
): Promise<FabricType> {
  const item = await FabricType.findByPk(id);
  if (!item) throw new AppError('Tipo de tela no encontrado', 404);
  await item.update(input);
  return item;
}

// ─── SizeChart ────────────────────────────────────────────────────────────────

export async function listSizes(onlyActive = true) {
  return SizeChart.findAll({
    where: onlyActive ? { active: true } : {},
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
}

export async function createSize(input: MasterItemInput): Promise<SizeChart> {
  return SizeChart.create({
    name: input.name,
    active: input.active ?? true,
    sort_order: input.sort_order ?? 0,
  });
}

export async function updateSize(
  id: number,
  input: Partial<MasterItemInput>
): Promise<SizeChart> {
  const item = await SizeChart.findByPk(id);
  if (!item) throw new AppError('Talla no encontrada', 404);
  await item.update(input);
  return item;
}
