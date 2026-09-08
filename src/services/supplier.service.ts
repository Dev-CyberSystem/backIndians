/**
 * ABM de proveedores (directorio autónomo, sin enganche con stock/costos/pedidos).
 *
 * - Baja lógica por defecto (`active = false`): no se pierde el dato ni el
 *   historial de contacto. El borrado real es una operación aparte y en las
 *   rutas queda restringido a admin.
 * - El CUIT se guarda normalizado (solo dígitos) para que la unicidad no
 *   dependa de puntos/guiones/espacios.
 */

import { Op } from 'sequelize';
import { Supplier } from '../models';
import type { SupplierTaxCondition } from '../models/Supplier';
import { AppError } from '../middlewares/errorHandler';

export interface SupplierInput {
  business_name: string;
  trade_name?: string | null;
  category?: string | null;
  tax_id?: string | null;
  tax_condition?: SupplierTaxCondition | null;
  address?: string | null;
  province?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  contact_person?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
}

/** Deja solo los dígitos de un CUIT/valor (sin guiones ni espacios). */
export function normalizeTaxId(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/** Normaliza y valida el CUIT si vino informado. Devuelve dígitos o null. */
function resolveTaxId(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const digits = normalizeTaxId(trimmed);
  if (digits.length !== 11) {
    throw new AppError('El CUIT debe tener 11 dígitos (formato XX-XXXXXXXX-X)', 400);
  }
  return digits;
}

function cleanStr(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/**
 * Lista proveedores. Por defecto solo activos. Filtra por texto libre (razón
 * social / nombre comercial / CUIT / persona de contacto) y por rubro exacto.
 */
export async function listSuppliers(opts: {
  search?: string;
  category?: string;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
} = {}) {
  const term = opts.search?.trim();
  const category = opts.category?.trim();
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const where: Record<symbol | string, unknown> = {
    ...(opts.includeInactive ? {} : { active: true }),
    ...(category ? { category } : {}),
  };

  if (term) {
    const digits = normalizeTaxId(term);
    where[Op.or] = [
      { business_name: { [Op.like]: `%${term}%` } },
      { trade_name: { [Op.like]: `%${term}%` } },
      { contact_person: { [Op.like]: `%${term}%` } },
      ...(digits ? [{ tax_id: { [Op.like]: `%${digits}%` } }] : []),
    ];
  }

  const { rows, count } = await Supplier.findAndCountAll({
    where,
    order: [['business_name', 'ASC']],
    limit,
    offset,
  });

  return { rows, count, page, limit };
}

/** Rubros distintos ya cargados (para poblar el filtro del frontend). */
export async function listSupplierCategories(): Promise<string[]> {
  const rows = (await Supplier.findAll({
    attributes: ['category'],
    where: { category: { [Op.ne]: null } },
    group: ['category'],
    order: [['category', 'ASC']],
    raw: true,
  })) as unknown as Array<{ category: string | null }>;
  return rows.map((r) => r.category).filter((c): c is string => !!c && c.trim() !== '');
}

export async function getSupplier(id: number): Promise<Supplier> {
  const supplier = await Supplier.findByPk(id);
  if (!supplier) throw new AppError('El proveedor no existe', 404);
  return supplier;
}

export async function createSupplier(input: SupplierInput, userId?: number): Promise<Supplier> {
  const business_name = input.business_name?.trim();
  if (!business_name) throw new AppError('La razón social es obligatoria', 400);

  const tax_id = resolveTaxId(input.tax_id);
  if (tax_id) {
    const duplicate = await Supplier.findOne({ where: { tax_id } });
    if (duplicate) {
      throw new AppError(`Ya existe un proveedor con ese CUIT (${duplicate.business_name})`, 409);
    }
  }

  return Supplier.create({
    business_name,
    trade_name: cleanStr(input.trade_name),
    category: cleanStr(input.category),
    tax_id,
    tax_condition: input.tax_condition ?? null,
    address: cleanStr(input.address),
    province: cleanStr(input.province),
    locality: cleanStr(input.locality),
    postal_code: cleanStr(input.postal_code),
    phone: cleanStr(input.phone),
    whatsapp: cleanStr(input.whatsapp),
    email: cleanStr(input.email),
    contact_person: cleanStr(input.contact_person),
    payment_terms: cleanStr(input.payment_terms),
    notes: cleanStr(input.notes),
    active: true,
    created_by_user_id: userId ?? null,
    updated_by_user_id: userId ?? null,
  });
}

export async function updateSupplier(
  id: number,
  input: Partial<SupplierInput>,
  userId?: number
): Promise<Supplier> {
  const supplier = await Supplier.findByPk(id);
  if (!supplier) throw new AppError('El proveedor no existe', 404);

  if (input.business_name !== undefined) {
    const business_name = input.business_name.trim();
    if (!business_name) throw new AppError('La razón social es obligatoria', 400);
    supplier.business_name = business_name;
  }

  if (input.tax_id !== undefined) {
    const tax_id = resolveTaxId(input.tax_id);
    if (tax_id) {
      const duplicate = await Supplier.findOne({ where: { tax_id, id: { [Op.ne]: id } } });
      if (duplicate) {
        throw new AppError(`Ya existe un proveedor con ese CUIT (${duplicate.business_name})`, 409);
      }
    }
    supplier.tax_id = tax_id;
  }

  if (input.trade_name !== undefined) supplier.trade_name = cleanStr(input.trade_name);
  if (input.category !== undefined) supplier.category = cleanStr(input.category);
  if (input.tax_condition !== undefined) supplier.tax_condition = input.tax_condition ?? null;
  if (input.address !== undefined) supplier.address = cleanStr(input.address);
  if (input.province !== undefined) supplier.province = cleanStr(input.province);
  if (input.locality !== undefined) supplier.locality = cleanStr(input.locality);
  if (input.postal_code !== undefined) supplier.postal_code = cleanStr(input.postal_code);
  if (input.phone !== undefined) supplier.phone = cleanStr(input.phone);
  if (input.whatsapp !== undefined) supplier.whatsapp = cleanStr(input.whatsapp);
  if (input.email !== undefined) supplier.email = cleanStr(input.email);
  if (input.contact_person !== undefined) supplier.contact_person = cleanStr(input.contact_person);
  if (input.payment_terms !== undefined) supplier.payment_terms = cleanStr(input.payment_terms);
  if (input.notes !== undefined) supplier.notes = cleanStr(input.notes);
  supplier.updated_by_user_id = userId ?? supplier.updated_by_user_id ?? null;

  await supplier.save();
  return supplier;
}

/** Baja lógica: el proveedor deja de aparecer salvo que se pidan los inactivos. */
export async function setSupplierActive(id: number, active: boolean): Promise<Supplier> {
  const supplier = await Supplier.findByPk(id);
  if (!supplier) throw new AppError('El proveedor no existe', 404);
  supplier.active = active;
  await supplier.save();
  return supplier;
}

/** Borrado real. En las rutas queda restringido a admin. */
export async function deleteSupplier(id: number): Promise<void> {
  const supplier = await Supplier.findByPk(id);
  if (!supplier) throw new AppError('El proveedor no existe', 404);
  await supplier.destroy();
}
