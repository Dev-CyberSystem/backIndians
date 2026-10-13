/**
 * Soporte del menú de la tienda (brief de modificaciones web 06.10.2026, pedido 04).
 *
 * Dos piezas puras (sin DB, testeables): el parseo del filtro `tag` con varios
 * valores, y el cálculo de qué submenús tienen productos disponibles.
 */

/**
 * Tag con el que se marcan las camisetas de selecciones dentro de Fútbol.
 * Supuesto vigente: Indians todavía no definió cómo identificar una selección,
 * se usa este tag. Tiene que escribirse EXACTO en el producto (acento incluido).
 */
export const SELECTION_TAG = 'Selección';

/** Tope de valores en `?tag=a,b,c` (evita consultas gigantes por query string). */
export const MAX_TAG_FILTERS = 5;

/** "Top, Remera" → ['Top', 'Remera']. Sin duplicados ni vacíos. */
export function parseTagFilter(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim();
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAG_FILTERS) break;
  }
  return [...seen];
}

export interface NavProductRow {
  category: string | null;
  gender: string | null;
  client_id: number;
  /** JSON (array o string serializado) tal como lo devuelve la DB. */
  tags: unknown;
}

export interface NavAvailability {
  /** categoría → géneros con productos activos en la tienda. */
  category_genders: Record<string, string[]>;
  /** categoría → tags presentes en sus productos. */
  category_tags: Record<string, string[]>;
  /** categoría → clientes (clubes) con productos; excluye los de selecciones. */
  category_clients: Record<string, { id: number; name: string }[]>;
}

function parseTags(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
}

export function buildNavAvailability(
  rows: NavProductRow[],
  clientNames: Map<number, string>,
): NavAvailability {
  const genders = new Map<string, Set<string>>();
  const tags = new Map<string, Set<string>>();
  const clients = new Map<string, Map<number, string>>();

  for (const row of rows) {
    const category = row.category?.trim();
    if (!category) continue;
    const productTags = parseTags(row.tags);

    if (row.gender) {
      if (!genders.has(category)) genders.set(category, new Set());
      genders.get(category)!.add(row.gender);
    }
    if (productTags.length > 0) {
      if (!tags.has(category)) tags.set(category, new Set());
      productTags.forEach((t) => tags.get(category)!.add(t));
    }
    // Una camiseta de selección no cuenta como "club": va en su propio submenú.
    const name = clientNames.get(row.client_id);
    if (name && !productTags.includes(SELECTION_TAG)) {
      if (!clients.has(category)) clients.set(category, new Map());
      clients.get(category)!.set(row.client_id, name);
    }
  }

  const toRecord = <T,>(m: Map<string, T>, map: (v: T) => unknown) =>
    Object.fromEntries([...m.entries()].map(([k, v]) => [k, map(v)]));

  return {
    category_genders: toRecord(genders, (s) => [...s].sort()) as Record<string, string[]>,
    category_tags: toRecord(tags, (s) => [...s].sort()) as Record<string, string[]>,
    category_clients: toRecord(clients, (m) =>
      [...m.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    ) as Record<string, { id: number; name: string }[]>,
  };
}
