// Escenario 2: login de comprador de tienda, rotando sobre los ~200
// stress-customer-*@example.com sembrados por seed-load-data.ts. Mide el
// costo real de bcrypt (CPU) bajo concurrencia — hot-spot típico en un
// proceso Node único sin cluster.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, thresholds, VUS, DURATION, jsonHeaders } from './lib/config.js';

export const options = { vus: VUS, duration: DURATION, thresholds: thresholds() };

const CUSTOMER_COUNT = Number(__ENV.CUSTOMER_COUNT || 200);
const PASSWORD = 'StressTest123!';

export default function () {
  const n = 1 + Math.floor(Math.random() * CUSTOMER_COUNT);
  const email = `stress-customer-${n}@example.com`;

  const res = http.post(
    `${API}/store/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    jsonHeaders()
  );

  check(res, {
    'login 200': (r) => r.status === 200,
    'trae accessToken': (r) => {
      try {
        return !!JSON.parse(r.body)?.data?.tokens?.accessToken;
      } catch {
        return false;
      }
    },
  });

  sleep(0.2);
}
