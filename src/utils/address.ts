/**
 * Armado de la línea de calle de una dirección de envío.
 *
 * Piso y departamento son opcionales (checkout de tienda): si vienen, se
 * agregan a la calle para que aparezcan en la etiqueta de envío y en el
 * comprobante; si no, la línea queda igual que siempre.
 */

export interface AddressUnitParts {
  street?: string | null;
  floor?: string | null;
  apartment?: string | null;
}

/** "Av. Mate de Luna 1234, Piso 4, Depto B" — omite lo que no se informó. */
export function streetWithUnit(addr: AddressUnitParts | null | undefined): string {
  if (!addr) return '';
  const floor = addr.floor?.trim();
  const apartment = addr.apartment?.trim();
  return [
    addr.street?.trim(),
    floor ? `Piso ${floor}` : null,
    apartment ? `Depto ${apartment}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Texto libre opcional → string recortado, o undefined si quedó vacío. */
export function optionalUnit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}
