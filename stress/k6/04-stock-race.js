// Escenario 4: condición de carrera de stock. N compradores intentan comprar
// 1 unidad del MISMO producto (STRESS-RACE, stock fijo en 5) al mismo tiempo.
// No es una prueba de capacidad — es una prueba de INTEGRIDAD: si el ledger
// (stockLedger.service.ts, SELECT...FOR UPDATE dentro de transacción) está
// bien implementado, como mucho 5 checkouts deberían tener éxito (201) y el
// resto debería fallar con "sin stock" (409/422) — nunca vender de más.
//
// Antes de correr esto: reponer el stock a 5 con
//   npx ts-node --project ../tsconfig.seed.json stress/seed-load-data.ts --reset-race-stock
//
// Después de correr esto: verificar con
//   npx ts-node --project ../tsconfig.seed.json stress/verify-race-integrity.ts
import http from 'k6/http';
import { check } from 'k6';
import { API, thresholds, jsonHeaders, uuidv4 } from './lib/config.js';

const ATTEMPTS = Number(__ENV.VUS || 50); // ojo: acá VUS = intentos simultáneos, no nivel de rampa

export const options = {
  scenarios: {
    race: {
      executor: 'shared-iterations',
      vus: ATTEMPTS,
      iterations: ATTEMPTS,
      maxDuration: '30s',
    },
  },
  thresholds: thresholds(),
};

export function setup() {
  const res = http.get(`${API}/store/products?category=Stress&limit=60`);
  const body = JSON.parse(res.body);
  const race = (body?.data ?? []).find((p) => p.title === 'STRESS-RACE');
  if (!race) {
    throw new Error('No existe STRESS-RACE. Corré antes stress/seed-load-data.ts');
  }
  return { productId: race.id };
}

export default function (data) {
  const uniq = `${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${API}/store/checkout`,
    JSON.stringify({
      customerName: `Race Buyer ${uniq}`,
      customerEmail: `stress-race-${uniq}@example.com`,
      items: [{ catalog_product_id: data.productId, quantity: 1, size_name: 'U' }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
      accept_terms: true,
    }),
    jsonHeaders({ 'Idempotency-Key': uuidv4() })
  );

  check(res, {
    'respuesta esperada (201 vendido | 4xx sin stock)': (r) => r.status === 201 || (r.status >= 400 && r.status < 500),
  });
}
