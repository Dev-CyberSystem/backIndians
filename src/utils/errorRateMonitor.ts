import { sendAlert } from './alerts';

/**
 * Detector de errores 5xx sostenidos (condición C7).
 *
 * El watchdog externo (UptimeRobot) pega contra `/health` y detecta que el
 * sistema esté MUERTO. Lo que no puede ver es el sistema **vivo pero fallando**:
 * `/health` responde 200 mientras el checkout tira 500 en cada intento. Este
 * módulo cubre ese hueco.
 *
 * Ventana deslizante simple, en memoria: se guardan los timestamps de los 5xx
 * de los últimos `WINDOW_MINUTES` y, si superan `THRESHOLD`, se dispara una
 * alerta. El cooldown de `sendAlert` evita que una falla sostenida mande un
 * aviso por cada request.
 *
 * En memoria y no en base a propósito: si el problema es justamente que la
 * base no responde, un contador que necesita escribir en ella no serviría de
 * nada. La contra es que con varias réplicas cada una cuenta por su lado — hoy
 * corre una sola (condición C4), y si eso cambia el umbral hay que revisarlo.
 */

const WINDOW_MS = Number(process.env.ALERT_5XX_WINDOW_MINUTES ?? 5) * 60 * 1000;
const THRESHOLD = Number(process.env.ALERT_5XX_THRESHOLD ?? 10);

let hits: number[] = [];

/** Sólo para los tests. */
export function __resetErrorRate(): void {
  hits = [];
}

/**
 * Registra un 5xx y dispara la alerta si se superó el umbral en la ventana.
 * No se espera (`void`): el error handler no debe demorar la respuesta al
 * cliente por mandar un aviso.
 */
export function recordServerError(context: { method?: string; url?: string; message?: string }): void {
  const now = Date.now();
  hits.push(now);
  hits = hits.filter((t) => now - t < WINDOW_MS);

  if (hits.length < THRESHOLD) return;

  const minutes = Math.round(WINDOW_MS / 60000);
  void sendAlert({
    key: 'errores-5xx-sostenidos',
    severity: 'critical',
    title: `${hits.length} errores de servidor en ${minutes} min`,
    detail:
      `El sistema está respondiendo pero acumuló ${hits.length} errores 5xx en los ` +
      `últimos ${minutes} minutos (umbral: ${THRESHOLD}).\n\n` +
      `Último error:\n` +
      `  ${context.method ?? '?'} ${context.url ?? '?'}\n` +
      `  ${context.message ?? 'sin mensaje'}\n\n` +
      `Revisar los logs de Railway filtrando por "unhandledError".`,
  });

  // Se limpia la ventana tras alertar: si no, el contador queda por encima del
  // umbral y se re-dispara con cada 5xx nuevo hasta que la ventana venza sola.
  hits = [];
}
