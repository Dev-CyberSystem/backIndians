import { Transaction } from 'sequelize';
import { sequelize } from '../config/db';
import {
  GarmentCostItem,
  GarmentCost,
  GarmentCostVersion,
  GarmentCostVersionItem,
  OrderCostDetail,
  GarmentType,
  Client,
  User,
  OrderItem,
} from '../models';
import { AppError } from '../middlewares/errorHandler';
import { JwtPayload, SizesMap } from '../types';

// ─── Tipos ─────────────────────────────────────────────────────────────────

type CostCategory = 'jersey' | 'shorts';

export interface CostSheetItem {
  cost_item_id: number;
  key: string;
  label: string;
  group_key: string | null;
  amount: number;
}

export interface CostSheet {
  client_id: number;
  garment_type_id: number;
  garment_type_name: string;
  category: CostCategory | null;
  garment_cost_id: number | null;
  version_number: number | null;
  total_cost: number;
  updated_at: Date | null;
  updated_by_name: string | null;
  items: CostSheetItem[];
}

export interface SaveCostInput {
  key?: string;
  cost_item_id?: number;
  amount: number;
}

export interface ClientCostSheetSummary {
  garment_cost_id: number;
  garment_type_id: number;
  garment_type_name: string;
  category: CostCategory | null;
  total_cost: number;
  version_number: number | null;
  updated_at: Date;
  updated_by_name: string | null;
}

export interface OrderCostPreviewLine {
  garment_type_id: number;
  garment_type_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  has_costs: boolean;
}

export interface OrderCostPreview {
  client_id: number;
  detail: OrderCostPreviewLine[];
  total: number;
}

export interface OrderCostDetailLine {
  order_item_id: number | null;
  garment_type_id: number | null;
  garment_type_name: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
  garment_cost_version_id: number | null;
  has_costs: boolean;
}

export interface OrderCostDetailView {
  order_id: number;
  detail: OrderCostDetailLine[];
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Redondeo a 2 decimales para evitar arrastre de floats en la suma de dinero.
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function sumAmounts(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + (a || 0), 0));
}

async function requireGarmentType(garmentTypeId: number): Promise<GarmentType> {
  const gt = await GarmentType.findByPk(garmentTypeId);
  if (!gt) throw new AppError('Tipo de prenda no encontrado', 404);
  return gt;
}

// ─── Maestro de ítems por categoría ────────────────────────────────────────

// Listas fijas de ítems de costo. Fuente de verdad usada por el seed idempotente
// (ensureGarmentCostItems) — refleja lo que también siembra la migración 060.
const COST_ITEM_SEED: Record<CostCategory, Array<{ key: string; label: string; group_key: string | null }>> = {
  jersey: [
    { key: 'tela_principal',       label: 'Tela principal',              group_key: null },
    { key: 'tela_delantera',       label: 'Tela delantera (doble tela)', group_key: 'doble_tela' },
    { key: 'tela_trasera',         label: 'Tela trasera (doble tela)',   group_key: 'doble_tela' },
    { key: 'hilos',                label: 'Hilos',                       group_key: null },
    { key: 'cierre',               label: 'Cierre',                      group_key: null },
    { key: 'cuello_tejido',        label: 'Cuello tejido',               group_key: 'cuello' },
    { key: 'cuello_misma_tela',    label: 'Cuello en misma tela',        group_key: 'cuello' },
    { key: 'cuello_dry',           label: 'Cuello Dry',                  group_key: 'cuello' },
    { key: 'cuello_lycra',         label: 'Cuello Lycra',                group_key: 'cuello' },
    { key: 'etiqueta_composicion', label: 'Etiqueta de composición',     group_key: null },
    { key: 'etiqueta_talle',       label: 'Etiqueta de talle',           group_key: null },
    { key: 'etiqueta_colgante',    label: 'Etiqueta colgante',           group_key: null },
    { key: 'marca',                label: 'Marca',                       group_key: null },
    { key: 'escudo',               label: 'Escudo',                      group_key: null },
    { key: 'sponsors',             label: 'Sponsors',                    group_key: null },
    { key: 'apliques',             label: 'Apliques',                    group_key: null },
    { key: 'parche',               label: 'Parche',                      group_key: null },
    { key: 'nombre',               label: 'Nombre',                      group_key: null },
    { key: 'numero',               label: 'Número',                      group_key: null },
  ],
  shorts: [
    { key: 'tela',                 label: 'Tela',                        group_key: null },
    { key: 'hilos',                label: 'Hilos',                       group_key: null },
    { key: 'elastico',             label: 'Elástico',                    group_key: null },
    { key: 'etiquetas',            label: 'Etiquetas',                   group_key: null },
    { key: 'etiqueta_composicion', label: 'Etiqueta de composición',     group_key: null },
    { key: 'etiqueta_talle',       label: 'Etiqueta de talle',           group_key: null },
    { key: 'etiqueta_colgante',    label: 'Etiqueta colgante',           group_key: null },
    { key: 'marca',                label: 'Marca',                       group_key: null },
    { key: 'escudo',               label: 'Escudo',                      group_key: null },
    { key: 'sponsors',             label: 'Sponsors',                    group_key: null },
    { key: 'apliques',             label: 'Apliques',                    group_key: null },
    { key: 'parche',               label: 'Parche',                      group_key: null },
    { key: 'numero',               label: 'Número',                      group_key: null },
  ],
};

/**
 * Siembra/actualiza el maestro de ítems de costo de forma idempotente. Necesario
 * porque en desarrollo la DB se crea con sequelize.sync() (no corre el seed de la
 * migración). Se llama al arrancar el server; en producción es no-op tras migrar.
 */
export async function ensureGarmentCostItems(): Promise<void> {
  for (const category of ['jersey', 'shorts'] as CostCategory[]) {
    const list = COST_ITEM_SEED[category];
    for (let i = 0; i < list.length; i++) {
      const { key, label, group_key } = list[i];
      const [row, created] = await GarmentCostItem.findOrCreate({
        where: { category, key },
        defaults: { category, key, label, group_key, sort_order: i, active: true },
      });
      // Mantiene label/orden/grupo al día si cambió la definición
      if (!created && (row.label !== label || row.group_key !== group_key || row.sort_order !== i)) {
        await row.update({ label, group_key, sort_order: i });
      }
    }
  }
}

export async function listCostItems(category: CostCategory): Promise<GarmentCostItem[]> {
  return GarmentCostItem.findAll({
    where: { category, active: true },
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });
}

// ─── Hoja de costos actual (cliente + tipo de prenda) ──────────────────────

export async function getCostSheet(
  clientId: number,
  garmentTypeId: number
): Promise<CostSheet> {
  const client = await Client.findByPk(clientId);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  const garment = await requireGarmentType(garmentTypeId);

  const category = (garment.cost_category as CostCategory | null) ?? null;

  const base: CostSheet = {
    client_id: clientId,
    garment_type_id: garmentTypeId,
    garment_type_name: garment.name,
    category,
    garment_cost_id: null,
    version_number: null,
    total_cost: 0,
    updated_at: null,
    updated_by_name: null,
    items: [],
  };

  // Sin categoría asignada no hay lista de ítems: el front pide asignarla.
  if (!category) return base;

  const masterItems = await listCostItems(category);

  const garmentCost = await GarmentCost.findOne({
    where: { client_id: clientId, garment_type_id: garmentTypeId },
    include: [
      { model: User, as: 'editor', attributes: ['id', 'name'] },
      {
        model: GarmentCostVersion,
        as: 'current_version',
        include: [{ model: GarmentCostVersionItem, as: 'items' }],
      },
    ],
  });

  // Monto vigente por key (de la última versión)
  const amountByKey = new Map<string, number>();
  const version = (garmentCost as GarmentCost | null)?.current_version;
  if (version?.items) {
    for (const vi of version.items) amountByKey.set(vi.item_key, vi.amount);
  }

  base.items = masterItems.map((mi) => ({
    cost_item_id: mi.id,
    key: mi.key,
    label: mi.label,
    group_key: mi.group_key ?? null,
    amount: amountByKey.get(mi.key) ?? 0,
  }));

  if (garmentCost) {
    base.garment_cost_id = garmentCost.id;
    base.version_number = version?.version_number ?? null;
    base.total_cost = garmentCost.total_cost;
    base.updated_at = garmentCost.updatedAt;
    base.updated_by_name = (garmentCost as GarmentCost & { editor?: User }).editor?.name ?? null;
  }

  return base;
}

// ─── Guardar / editar (genera una versión nueva) ───────────────────────────

export async function saveCostSheet(
  clientId: number,
  garmentTypeId: number,
  inputItems: SaveCostInput[],
  user: JwtPayload
): Promise<CostSheet> {
  const client = await Client.findByPk(clientId);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  const garment = await requireGarmentType(garmentTypeId);
  const category = garment.cost_category as CostCategory | null;
  if (!category) {
    throw new AppError(
      'El tipo de prenda no tiene categoría de costo asignada. Asignala en "Tipos de prenda" antes de cargar costos.',
      400,
      undefined,
      { code: 'GARMENT_WITHOUT_CATEGORY', type: 'BusinessRuleError' }
    );
  }

  const masterItems = await listCostItems(category);
  const masterByKey = new Map(masterItems.map((mi) => [mi.key, mi]));
  const masterById = new Map(masterItems.map((mi) => [mi.id, mi]));

  // Normaliza la entrada contra el maestro (ignora keys desconocidas), toma el
  // último monto si viene repetida y descarta montos <= 0 (no se guardan ceros).
  const amountByKey = new Map<string, number>();
  for (const it of inputItems) {
    const master = it.cost_item_id != null ? masterById.get(it.cost_item_id) : (it.key ? masterByKey.get(it.key) : undefined);
    if (!master) continue;
    const amount = round2(Number(it.amount) || 0);
    if (amount <= 0) { amountByKey.delete(master.key); continue; }
    amountByKey.set(master.key, amount);
  }

  const total = sumAmounts([...amountByKey.values()]);

  await sequelize.transaction(async (t) => {
    const [garmentCost] = await GarmentCost.findOrCreate({
      where: { client_id: clientId, garment_type_id: garmentTypeId },
      defaults: { client_id: clientId, garment_type_id: garmentTypeId, total_cost: 0 },
      transaction: t,
    });

    const last = await GarmentCostVersion.findOne({
      where: { garment_cost_id: garmentCost.id },
      order: [['version_number', 'DESC']],
      transaction: t,
    });
    const nextVersion = (last?.version_number ?? 0) + 1;

    const newVersion = await GarmentCostVersion.create({
      garment_cost_id: garmentCost.id,
      version_number: nextVersion,
      total_cost: total,
      created_by: user.id,
    }, { transaction: t });

    const versionItems = [...amountByKey.entries()].map(([key, amount]) => {
      const master = masterByKey.get(key)!;
      return {
        version_id: newVersion.id,
        cost_item_id: master.id,
        item_key: master.key,
        item_label: master.label,
        amount,
      };
    });
    if (versionItems.length > 0) {
      await GarmentCostVersionItem.bulkCreate(versionItems, { transaction: t });
    }

    await garmentCost.update({
      total_cost: total,
      current_version_id: newVersion.id,
      updated_by: user.id,
    }, { transaction: t });
  });

  return getCostSheet(clientId, garmentTypeId);
}

// ─── Historial de una prenda ───────────────────────────────────────────────

export async function getCostHistory(clientId: number, garmentTypeId: number) {
  const garment = await requireGarmentType(garmentTypeId);
  const garmentCost = await GarmentCost.findOne({
    where: { client_id: clientId, garment_type_id: garmentTypeId },
  });

  const base = {
    client_id: clientId,
    garment_type_id: garmentTypeId,
    garment_type_name: garment.name,
    versions: [] as unknown[],
  };
  if (!garmentCost) return base;

  const versions = await GarmentCostVersion.findAll({
    where: { garment_cost_id: garmentCost.id },
    include: [
      { model: User, as: 'creator', attributes: ['id', 'name'] },
      { model: GarmentCostVersionItem, as: 'items' },
    ],
    order: [['version_number', 'DESC']],
  });

  base.versions = versions.map((v) => ({
    id: v.id,
    version_number: v.version_number,
    total_cost: v.total_cost,
    created_at: v.createdAt,
    created_by_name: (v as GarmentCostVersion & { creator?: User }).creator?.name ?? null,
    items: (v.items ?? []).map((i) => ({
      key: i.item_key,
      label: i.item_label,
      amount: i.amount,
    })),
  }));
  return base;
}

// ─── Prendas con costo de un cliente ───────────────────────────────────────

export async function listClientCostSheets(clientId: number): Promise<ClientCostSheetSummary[]> {
  const client = await Client.findByPk(clientId);
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const sheets = await GarmentCost.findAll({
    where: { client_id: clientId },
    include: [
      { model: GarmentType, as: 'garmentType', attributes: ['id', 'name', 'cost_category'] },
      { model: GarmentCostVersion, as: 'current_version', attributes: ['id', 'version_number'] },
      { model: User, as: 'editor', attributes: ['id', 'name'] },
    ],
    order: [['updatedAt', 'DESC']],
  });

  return sheets.map((s) => ({
    garment_cost_id: s.id,
    garment_type_id: s.garment_type_id,
    garment_type_name: (s as GarmentCost & { garmentType?: GarmentType }).garmentType?.name ?? '',
    category: (s as GarmentCost & { garmentType?: GarmentType }).garmentType?.cost_category ?? null,
    total_cost: s.total_cost,
    version_number: (s as GarmentCost & { current_version?: GarmentCostVersion }).current_version?.version_number ?? null,
    updated_at: s.updatedAt,
    updated_by_name: (s as GarmentCost & { editor?: User }).editor?.name ?? null,
  }));
}

// ─── Preview de costos de un pedido (en vivo, costos vigentes) ──────────────

interface PreviewLineInput {
  garment_type_id: number;
  quantity: number;
}

export async function previewOrderCosts(clientId: number, lines: PreviewLineInput[]): Promise<OrderCostPreview> {
  const garmentTypeIds = [...new Set(lines.map((l) => l.garment_type_id).filter(Boolean))];
  const garments = await GarmentType.findAll({ where: { id: garmentTypeIds } });
  const garmentById = new Map(garments.map((g) => [g.id, g]));

  const costs = await GarmentCost.findAll({
    where: { client_id: clientId, garment_type_id: garmentTypeIds },
  });
  const costByGarment = new Map(costs.map((c) => [c.garment_type_id, c]));

  const detail = lines.map((l) => {
    const garment = garmentById.get(l.garment_type_id);
    const cost = costByGarment.get(l.garment_type_id) ?? null;
    const unit = cost ? cost.total_cost : 0;
    const qty = l.quantity || 0;
    return {
      garment_type_id: l.garment_type_id,
      garment_type_name: garment?.name ?? '',
      quantity: qty,
      unit_cost: unit,
      line_total: round2(unit * qty),
      has_costs: !!cost,
    };
  });

  const total = round2(detail.reduce((s, d) => s + d.line_total, 0));
  return { client_id: clientId, detail, total };
}

// ─── Snapshot congelado del pedido ─────────────────────────────────────────

const unitsOf = (sizes: SizesMap | null | undefined): number =>
  Object.values(sizes ?? {}).reduce((s, q) => s + (Number(q) || 0), 0);

/**
 * Congela el detalle de costos de un pedido con los costos vigentes. Se llama
 * dentro de la transacción de creación/actualización del pedido. `orderItems`
 * son las filas ya persistidas (con id + garment_type_id + sizes).
 */
export async function buildOrderCostSnapshot(
  orderId: number,
  clientId: number,
  orderItems: OrderItem[],
  transaction: Transaction
): Promise<void> {
  // Limpia snapshot previo (en updates que reemplazan ítems)
  await OrderCostDetail.destroy({ where: { order_id: orderId }, transaction });

  if (orderItems.length === 0) return;

  const garmentTypeIds = [...new Set(orderItems.map((i) => i.garment_type_id).filter(Boolean))];
  const garments = await GarmentType.findAll({ where: { id: garmentTypeIds }, transaction });
  const garmentById = new Map(garments.map((g) => [g.id, g]));
  const costs = await GarmentCost.findAll({
    where: { client_id: clientId, garment_type_id: garmentTypeIds },
    transaction,
  });
  const costByGarment = new Map(costs.map((c) => [c.garment_type_id, c]));

  const rows = orderItems.map((item) => {
    const cost = costByGarment.get(item.garment_type_id) ?? null;
    const unit = cost ? cost.total_cost : 0;
    const qty = unitsOf(item.sizes);
    return {
      order_id: orderId,
      order_item_id: item.id,
      garment_type_id: item.garment_type_id,
      garment_type_name: garmentById.get(item.garment_type_id)?.name ?? null,
      garment_cost_id: cost?.id ?? null,
      garment_cost_version_id: cost?.current_version_id ?? null,
      quantity: qty,
      unit_cost: unit,
      line_total: round2(unit * qty),
    };
  });

  await OrderCostDetail.bulkCreate(rows, { transaction });
}

// ─── Detalle de costos congelado de un pedido ──────────────────────────────

export async function getOrderCostDetails(orderId: number): Promise<OrderCostDetailView> {
  const rows = await OrderCostDetail.findAll({
    where: { order_id: orderId },
    order: [['id', 'ASC']],
  });
  const total = round2(rows.reduce((s, r) => s + r.line_total, 0));
  return {
    order_id: orderId,
    detail: rows.map((r) => ({
      order_item_id: r.order_item_id,
      garment_type_id: r.garment_type_id,
      garment_type_name: r.garment_type_name,
      quantity: r.quantity,
      unit_cost: r.unit_cost,
      line_total: r.line_total,
      garment_cost_version_id: r.garment_cost_version_id,
      has_costs: !!r.garment_cost_id,
    })),
    total,
  };
}
