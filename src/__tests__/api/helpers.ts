import request from 'supertest';
import { app } from '../../app';

/*
 * Helpers para los tests de API (supertest contra la app Express, sin levantar
 * el server). Requieren MySQL conectado y migrado; para el flujo de compra y el
 * login admin además hace falta haber corrido los seeders (npm run seed).
 */

export const API = '/api/v1';

export const api = () => request(app);

export const ADMIN = {
  email: process.env.ADMIN_EMAIL || 'admin@indians.com',
  password: process.env.ADMIN_PASSWORD || 'Admin123!',
};

/** Loguea como admin y devuelve el access token. Lanza si falla. */
export async function loginAdmin(): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send(ADMIN);
  if (res.status !== 200) {
    throw new Error(`Login admin falló (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const d = res.body?.data ?? {};
  const token = d.accessToken ?? d.token ?? d.access_token;
  if (!token) throw new Error(`Login admin sin token: ${JSON.stringify(res.body)}`);
  return token;
}

/** Usuarios de los 4 roles (creados por `npm run seed`). */
export const ROLES = {
  admin:    { email: 'admin@textil.com',        password: 'Admin123!' },
  billing:  { email: 'facturacion@textil.com',  password: 'Admin123!' },
  workshop: { email: 'taller@textil.com',       password: 'Admin123!' },
  seller:   { email: 'vendedor@textil.com',     password: 'Vendedor123!' },
} as const;

export type RoleKey = keyof typeof ROLES;

/**
 * Loguea con el usuario de un rol y devuelve su access token. Prueba la
 * contraseña del rol y cae a 'Admin123!' como fallback (algunas DBs sembradas
 * en distintos momentos tienen la misma contraseña para todos los usuarios y
 * findOrCreate no la actualiza).
 */
export async function loginAs(role: RoleKey): Promise<string> {
  const { email, password } = ROLES[role];
  const candidates = [...new Set([password, 'Admin123!'])];
  let last: { status: number; body: unknown } | undefined;
  for (const pw of candidates) {
    const res = await request(app).post(`${API}/auth/login`).send({ email, password: pw });
    if (res.status === 200) {
      const d = res.body?.data ?? {};
      const token = d.accessToken ?? d.token ?? d.access_token;
      if (token) return token;
    }
    last = { status: res.status, body: res.body };
  }
  throw new Error(`Login ${role} (${email}) falló (${last?.status}): ${JSON.stringify(last?.body)} — ¿corriste npm run seed?`);
}

/** Header Authorization Bearer listo para .set(). */
export function auth(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

/** Normaliza la lista de productos (puede venir como array o paginada). */
export function asProductList(body: any): any[] {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

/**
 * Recorre el catálogo y devuelve el primer producto con stock real (resolviendo
 * un talle disponible), o null. Itera todos los productos —no solo el primero—
 * para no fallar cuando algún producto se quedó sin stock por pedidos de prueba.
 */
export async function findPurchasable(): Promise<{ id: number; size: string | null } | null> {
  const list = await api().get(`${API}/store/products?limit=50`);
  for (const prod of asProductList(list.body)) {
    const detail = await api().get(`${API}/store/products/${prod.id}`);
    const p = detail.body?.data;
    if (!p) continue;
    const sizes = (p.sizes ?? []) as Array<{ size_name: string; stock_quantity: number }>;
    if (sizes.length > 0) {
      const withStock = sizes.find((s) => s.stock_quantity > 0);
      if (withStock) return { id: p.id, size: withStock.size_name };
    } else if ((p.stock_quantity ?? 0) > 0) {
      return { id: p.id, size: null };
    }
  }
  return null;
}
