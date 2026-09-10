import { UserRole } from '../types';

/** DTO técnico para el diseñador: no muta modelos ni deja precios anidados. */
export function productsForRole(data: unknown, role: UserRole | undefined): unknown {
  if (role !== 'designer') return data;
  const plain = JSON.parse(JSON.stringify(data));
  const monetaryKeys = new Set(['price', 'public_price', 'base_price', 'discount_percentage']);
  const scrub = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (monetaryKeys.has(key)) (value as Record<string, unknown>)[key] = null;
      else scrub(child);
    }
  };
  scrub(plain);
  return plain;
}
