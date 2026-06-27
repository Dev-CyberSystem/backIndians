/**
 * Caché simple en memoria con TTL para respuestas costosas y poco cambiantes
 * (opciones de filtro, settings públicos). Reduce la carga sobre MySQL en el
 * camino caliente del tráfico de la tienda.
 *
 * Es por-instancia (no compartida entre réplicas). Para una sola instancia
 * (como en Railway por defecto) es suficiente; con varias réplicas, cada una
 * tiene su copia y converge por el TTL.
 */
interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();

/** Devuelve el valor cacheado si está vigente; si no, ejecuta `fn`, lo guarda y lo devuelve. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Invalida una clave exacta o todas las que empiecen con ese prefijo. */
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(prefix)) store.delete(key);
  }
}

/** Vacía todo el caché (útil en tests). */
export function clearCache(): void {
  store.clear();
}
