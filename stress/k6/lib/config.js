// Config compartida por todos los escenarios k6 de backIndians/stress/k6/.
// Todo parametrizable por env así el orquestador (run-k6.mjs) puede correr
// niveles crecientes de VUs sin tocar los scripts.

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1`;

export const VUS = Number(__ENV.VUS || 10);
export const DURATION = __ENV.DURATION || '20s';

// Umbrales informativos (no abortan la corrida — abortOnFail:false — porque
// queremos ver la curva completa incluso pasado el punto de quiebre).
export function thresholds() {
  return {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: false }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
  };
}

export function jsonHeaders(extra = {}) {
  return { headers: { 'Content-Type': 'application/json', ...extra } };
}

// UUIDv4 simple (Math.random) — alcanza para unicidad en un test de carga,
// no hace falta calidad criptográfica. El backend valida el header
// Idempotency-Key con isUUID() (store.routes.ts:76), así que cualquier string
// arbitrario lo rechaza con 422 antes de tocar la lógica de checkout.
export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
