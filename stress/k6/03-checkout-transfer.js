// Escenario 3 (el más importante): compra invitado de punta a punta —
// listar → cotizar → checkout por TRANSFERENCIA. Nunca usa payment_method
// "mercadopago", así que jamás llama a la API real de MercadoPago. El email
// del comprador siempre cae en @example.com, bloqueado SIEMPRE por
// mailGuard.ts (src/utils/mailGuard.ts) — ni con MAIL_ENABLED=1 se envía nada.
//
// Ejercita el camino de escritura real de una venta: transacción +
// SELECT...FOR UPDATE sobre stock (stockLedger.service.ts) + creación de
// StoreOrder — es donde se espera que aparezca la contención del pool de
// conexiones (max:10, src/config/db.ts) bajo concurrencia alta.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, thresholds, VUS, DURATION, jsonHeaders, uuidv4 } from './lib/config.js';

export const options = { vus: VUS, duration: DURATION, thresholds: thresholds() };

// setup() corre una sola vez: junta los ids de los productos STRESS-* reales
// vía la API pública (no asume nada de la base directamente).
export function setup() {
  const ids = [];
  for (let page = 1; page <= 5; page++) {
    const res = http.get(`${API}/store/products?category=Stress&limit=60&page=${page}`);
    if (res.status !== 200) break;
    const body = JSON.parse(res.body);
    const items = (body?.data ?? []).filter((p) => p.title !== 'STRESS-RACE');
    items.forEach((p) => ids.push(p.id));
    if (items.length < 60) break;
  }
  if (ids.length === 0) {
    throw new Error('No se encontraron productos STRESS-*. Corré antes: npx ts-node --project ../tsconfig.seed.json stress/seed-load-data.ts');
  }
  return { productIds: ids };
}

export default function (data) {
  const productId = data.productIds[Math.floor(Math.random() * data.productIds.length)];
  const uniq = `${__VU}-${__ITER}-${Date.now()}`;

  const quote = http.post(
    `${API}/store/checkout/quote`,
    JSON.stringify({
      items: [{ catalog_product_id: productId, quantity: 1, size_name: 'S' }],
      shipping_type: 'pickup',
    }),
    jsonHeaders()
  );
  check(quote, { 'quote 200': (r) => r.status === 200 });

  const checkout = http.post(
    `${API}/store/checkout`,
    JSON.stringify({
      customerName: `Stress Buyer ${uniq}`,
      customerEmail: `stress-buyer-${uniq}@example.com`,
      items: [{ catalog_product_id: productId, quantity: 1, size_name: 'S' }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
      accept_terms: true,
    }),
    jsonHeaders({ 'Idempotency-Key': uuidv4() })
  );

  check(checkout, {
    'checkout 201': (r) => r.status === 201,
    'no llamó a MercadoPago': (r) => {
      try {
        return !JSON.parse(r.body)?.data?.mp_init_point;
      } catch {
        return true;
      }
    },
  });

  sleep(0.3);
}
