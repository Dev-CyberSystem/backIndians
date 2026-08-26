// Escenario 5: panel de staff bajo carga — varios operadores mirando el
// dashboard y la lista de pedidos durante un pico de ventas. Login se hace
// UNA vez en setup() (cada login hace un write — user.increment('session_version')
// — no queremos medir eso acá, sino el costo de las lecturas del panel).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, thresholds, VUS, DURATION, jsonHeaders } from './lib/config.js';

export const options = { vus: VUS, duration: DURATION, thresholds: thresholds() };

const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@indians.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin123!';

export function setup() {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    jsonHeaders()
  );
  if (res.status !== 200) {
    throw new Error(`No se pudo loguear como staff (status ${res.status}): ${res.body}`);
  }
  const token = JSON.parse(res.body)?.data?.accessToken;
  if (!token) throw new Error('Login de staff no devolvió accessToken');
  return { token };
}

export default function (data) {
  const auth = jsonHeaders({ Authorization: `Bearer ${data.token}` });

  const dashboard = http.get(`${API}/dashboard/summary`, auth);
  check(dashboard, { 'dashboard 200': (r) => r.status === 200 });

  const page = 1 + Math.floor(Math.random() * 3);
  const orders = http.get(`${API}/orders?page=${page}&limit=20`, auth);
  check(orders, { 'orders 200': (r) => r.status === 200 });

  sleep(0.2);
}
