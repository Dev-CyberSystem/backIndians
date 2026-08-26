#!/usr/bin/env node
/**
 * Orquestador de los escenarios k6 (backIndians/stress/k6/). Corre cada
 * escenario en niveles crecientes de VUs (rampa manual, un proceso k6 por
 * nivel — mismo patrón que ya usaba stress/run-stress.js con autocannon) vía
 * `docker run grafana/k6`, sin instalar nada en el sistema.
 *
 * Uso:
 *   node stress/run-k6.mjs                        # todos los escenarios de rampa
 *   node stress/run-k6.mjs 01-catalog-browse       # solo uno
 *   node stress/run-k6.mjs --levels=10,50,200      # niveles custom
 *   node stress/run-k6.mjs --duration=15s
 *
 * BASE_URL apunta siempre a host.docker.internal (el backend corre en el
 * host, no en un contenedor) — no hace falta --network=host, que además no
 * funciona igual en Docker Desktop para Windows.
 *
 * El escenario 04-stock-race.js NO se corre acá: es un burst único, no una
 * rampa (ver stress/k6/04-stock-race.js y stress/verify-race-integrity.ts).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const PORT = process.env.PORT || '3000';
const BASE_URL = process.env.BASE_URL || `http://host.docker.internal:${PORT}`;

const RAMP_SCENARIOS = [
  '01-catalog-browse',
  '02-store-auth',
  '03-checkout-transfer',
  '05-admin-panel',
];

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);

const levels = (flags.levels ? flags.levels.split(',') : ['10', '25', '50', '100', '200', '400', '800']).map(Number);
const duration = flags.duration || '20s';
const scenarios = positional.length > 0 ? positional : RAMP_SCENARIOS;

const ERROR_RATE_LIMIT = 0.05;
const P95_LIMIT_MS = 3000;

function runK6(scenario, vus) {
  const scriptHostPath = path.join(__dirname, 'k6', `${scenario}.js`);
  if (!existsSync(scriptHostPath)) {
    throw new Error(`No existe el script k6 "${scenario}.js" en stress/k6/`);
  }
  const summaryFile = `${scenario}-${vus}vus.json`;
  const summaryHostPath = path.join(RESULTS_DIR, summaryFile);

  const dockerArgs = [
    'run', '--rm',
    '-v', `${__dirname}:/scripts`,
    'grafana/k6', 'run',
    `/scripts/k6/${scenario}.js`,
    '--summary-export', `/scripts/results/${summaryFile}`,
    '-e', `BASE_URL=${BASE_URL}`,
    '-e', `VUS=${vus}`,
    '-e', `DURATION=${duration}`,
    '--quiet',
  ];

  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit' });
  } catch (err) {
    // k6 sale con código != 0 cuando algún threshold se cruza (aunque tenga
    // abortOnFail:false) — es la señal que estamos buscando, no un error real.
    // El summary-export ya se escribió antes de que k6 saliera; si el archivo
    // no existe, ahí sí fue un fallo real (docker/red/script) y hay que propagarlo.
    if (!existsSync(summaryHostPath)) throw err;
  }
  return JSON.parse(readFileSync(summaryHostPath, 'utf-8'));
}

// Este k6 exporta el resumen con las métricas "planas" (sin .values anidado):
// { http_reqs: {count, rate}, http_req_duration: {p(95), med, ...},
//   http_req_failed: {value, ...} } — value es la tasa 0..1 de fails.
function extractRow(vus, summary) {
  const m = summary.metrics || {};
  const reqs = m.http_reqs?.count ?? 0;
  const rate = m.http_reqs?.rate ?? 0;
  const p95 = m.http_req_duration?.['p(95)'] ?? NaN;
  const p50 = m.http_req_duration?.med ?? NaN;
  const failRate = m.http_req_failed?.value ?? 0;
  return { vus, reqs, rate, p50, p95, failRate };
}

function printTable(scenario, rows) {
  console.log(`\n${'═'.repeat(78)}`);
  console.log(`ESCENARIO: ${scenario}`);
  console.log('═'.repeat(78));
  console.log(
    'VUs'.padStart(6) + 'req/s'.padStart(10) + 'p50(ms)'.padStart(10) +
    'p95(ms)'.padStart(10) + 'errores'.padStart(10) + 'total'.padStart(10)
  );
  console.log('─'.repeat(78));
  for (const r of rows) {
    console.log(
      String(r.vus).padStart(6) +
      r.rate.toFixed(1).padStart(10) +
      r.p50.toFixed(0).padStart(10) +
      r.p95.toFixed(0).padStart(10) +
      `${(r.failRate * 100).toFixed(1)}%`.padStart(10) +
      String(r.reqs).padStart(10)
    );
  }
}

async function main() {
  for (const scenario of scenarios) {
    const rows = [];
    let brokenStreak = 0;
    let breakingPoint = null;

    for (const vus of levels) {
      console.log(`\n▶ ${scenario} — ${vus} VUs, ${duration}...`);
      let summary;
      try {
        summary = runK6(scenario, vus);
      } catch (err) {
        console.error(`  ✗ k6 falló para ${vus} VUs: ${err.message}`);
        break;
      }
      const row = extractRow(vus, summary);
      rows.push(row);

      const broken = row.failRate > ERROR_RATE_LIMIT || row.p95 > P95_LIMIT_MS;
      brokenStreak = broken ? brokenStreak + 1 : 0;
      if (brokenStreak >= 2 && !breakingPoint) {
        breakingPoint = rows[rows.length - 2].vus; // el nivel anterior fue el último "sano"
      }
    }

    printTable(scenario, rows);
    if (breakingPoint) {
      console.log(`\n🔻 Punto de quiebre estimado: ~${breakingPoint} VUs (a partir de ahí, tasa de error >${ERROR_RATE_LIMIT * 100}% o p95 >${P95_LIMIT_MS}ms de forma sostenida).`);
    } else {
      console.log(`\n✅ No se alcanzó el punto de quiebre dentro de los niveles probados (máx ${levels[levels.length - 1]} VUs).`);
    }
  }
}

main().catch((err) => {
  console.error('❌ Error en el orquestador:', err);
  process.exit(1);
});
