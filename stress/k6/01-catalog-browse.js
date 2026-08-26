// Escenario 1: navegación pública de catálogo (solo lectura).
// Extiende stress/run-stress.js (que ya cubre esto con autocannon) con más
// variedad de filtros/paginación y con k6 para poder correr rampas de VUs.
//
//   docker run --rm -i grafana/k6 run -e BASE_URL=http://host.docker.internal:3000 -e VUS=100 -e DURATION=20s - < 01-catalog-browse.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, VUS, DURATION, thresholds } from './lib/config.js';

export const options = { vus: VUS, duration: DURATION, thresholds: thresholds() };

const PAGES = [1, 2, 3];

export default function () {
  const settings = http.get(`${API}/store/settings`);
  check(settings, { 'settings 200': (r) => r.status === 200 });

  const page = PAGES[Math.floor(Math.random() * PAGES.length)];
  const list = http.get(`${API}/store/products?category=Stress&limit=60&page=${page}`);
  check(list, { 'products 200': (r) => r.status === 200 });

  const filters = http.get(`${API}/store/products/filters`);
  check(filters, { 'filters 200': (r) => r.status === 200 });

  try {
    const body = JSON.parse(list.body);
    const items = body?.data ?? [];
    if (items.length > 0) {
      const pick = items[Math.floor(Math.random() * items.length)];
      const detail = http.get(`${API}/store/products/${pick.id}`);
      check(detail, { 'detail 200': (r) => r.status === 200 });
    }
  } catch {
    // respuesta inesperada bajo saturación — igual cuenta como fallo en check() de arriba
  }

  sleep(0.1);
}
