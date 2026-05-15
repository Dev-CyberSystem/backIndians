import { GarmentType, FabricType, SizeChart } from '../models';
import { AppError } from '../middlewares/errorHandler';

// ─── Tipos comunes para las tablas maestras ────────────────────────────────

interface MasterItemInput {
  name: string;
  active?: boolean;
  sort_order?: number;
}

// ─── GarmentType ──────────────────────────────────────────────────────────────

export async function listGarmentTypes(onlyActive = true) {
  return GarmentType.findAll({
    where: onlyActive ? { active: true } : {},
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
}

export async function createGarmentType(input: MasterItemInput): Promise<GarmentType> {
  return GarmentType.create({
    name: input.name,
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
