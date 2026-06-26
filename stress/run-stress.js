/* eslint-disable no-console */
/**
 * Prueba de stress de los endpoints públicos de la tienda (lecturas).
 *
 *   node stress/run-stress.js            (target por defecto :3100)
 *   BASE=http://localhost:3000 node stress/run-stress.js
 *
 * Mide req/s, latencia (p50/p99/p999) y errores por endpoint, en dos escenarios:
 * tráfico recurrente (normal) y pico (alto tráfico). No crea datos.
 */
const autocannon = require('autocannon');

const BASE = process.env.BASE || 'http://localhost:3100';
const API = `${BASE}/api/v1`;

// Escenarios de carga: conexiones concurrentes + duración.
const SCENARIOS = [
  { name: 'Recurrente (normal)', connections: 25, duration: 15 },
  { name: 'Pico (alto tráfico)',  connections: 150, duration: 20 },
];

async function getSampleProductId() {
  try {
    const res = await fetch(`${API}/store/products?limit=1`);
    const body = await res.json();
    const data = body?.data;
    const list = Array.isArray(data) ? data : data?.products ?? data?.rows ?? [];
    return list[0]?.id ?? null;
  } catch {
    return null;
  }
}

function bench(url, connections, duration) {
  return new Promise((resolve, reject) => {
    autocannon({ url, connections, duration, pipelining: 1 }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

function fmt(result) {
  const non2xx = result.non2xx || 0;
  const errors = result.errors || 0;
  return {
    reqSec: Math.round(result.requests.average),
    p50: result.latency.p50,
    p99: result.latency.p99,
    p999: result.latency.p99_9 ?? result.latency.p99,
    max: result.latency.max,
    totalReq: result.requests.total,
    non2xx,
    errors,
    timeouts: result.timeouts || 0,
  };
}

async function main() {
  const pid = await getSampleProductId();
  console.log(`\nTarget: ${API}`);
  console.log(`Producto de muestra para el detalle: ${pid ?? '(ninguno — se omite el detalle)'}\n`);

  const endpoints = [
    { name: 'health (baseline)',     path: '/health',                 full: `${BASE}/health` },
    { name: 'store/settings',        path: '/store/settings' },
    { name: 'store/products (lista)', path: '/store/products' },
    { name: 'store/products/filters', path: '/store/products/filters' },
    { name: 'store/promo-popup',     path: '/store/promo-popup' },
  ];
  if (pid) endpoints.push({ name: 'store/products/:id (detalle)', path: `/store/products/${pid}` });

  for (const scenario of SCENARIOS) {
    console.log('═'.repeat(92));
    console.log(`ESCENARIO: ${scenario.name}  —  ${scenario.connections} conexiones · ${scenario.duration}s c/u`);
    console.log('═'.repeat(92));
    console.log(
      'endpoint'.padEnd(30) +
      'req/s'.padStart(8) +
      'p50'.padStart(8) +
      'p99'.padStart(9) +
      'p999'.padStart(9) +
      'max'.padStart(8) +
      'total'.padStart(10) +
      'non2xx'.padStart(8) +
      'errs'.padStart(7)
    );
    console.log('─'.repeat(92));

    for (const ep of endpoints) {
      const url = ep.full || `${API}${ep.path}`;
      const r = fmt(await bench(url, scenario.connections, scenario.duration));
      console.log(
        ep.name.padEnd(30) +
        String(r.reqSec).padStart(8) +
        `${r.p50}ms`.padStart(8) +
        `${r.p99}ms`.padStart(9) +
        `${r.p999}ms`.padStart(9) +
        `${r.max}ms`.padStart(8) +
        String(r.totalReq).padStart(10) +
        String(r.non2xx).padStart(8) +
        String(r.errors + r.timeouts).padStart(7)
      );
    }
    console.log('');
  }

  console.log('Listo. (p50/p99/p999 = latencia en percentiles; non2xx = respuestas no exitosas; errs = errores/timeouts)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
