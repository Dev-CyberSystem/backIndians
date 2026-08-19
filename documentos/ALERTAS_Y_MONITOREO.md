# Alertas y monitoreo — Sistema Indians

> Cierra la **condición C7** de `AUDITORIA_INTEGRAL_PREPRODUCCION_2026-08-08.md`.
> Origen: el 2026-08-07 producción estuvo caída **más de un día** sin que nadie se enterara.

---

## El principio que ordena todo

**La alerta de que el sistema se cayó no puede vivir dentro del sistema que se cae.**

El incidente del 07/08 fue un *crash-loop*: el proceso ni siquiera arrancaba. Cualquier aviso programado dentro del backend habría estado muerto junto con él. Por eso hay **dos capas**, y ninguna reemplaza a la otra:

| Capa | Quién la ejecuta | Qué detecta | Qué NO detecta |
|---|---|---|---|
| **1 — Watchdog externo** (UptimeRobot) | Un servidor de terceros, fuera de Railway | Proceso muerto, crash-loop, Railway caído, MySQL caído, DNS roto | Fallas parciales: el sistema responde pero una ruta tira 500 |
| **2 — Alertas internas** (este código) | El backend, mientras está vivo | 5xx sostenidos | Cualquier cosa, si el proceso está muerto |

---

## Capa 1 — Watchdog externo (UptimeRobot)

### Qué monitorea

`GET https://<tu-backend>.up.railway.app/health`

Ese endpoint **verifica la base de datos**, no sólo que el proceso esté vivo. Antes devolvía `{status:'ok'}` sin tocar MySQL, así que con la base caída el monitor habría visto verde mientras el sistema estaba inutilizable. Hoy:

| Situación | Respuesta |
|---|---|
| Todo bien | `200` · `{"status":"ok","database":"ok","uptime_seconds":…,"response_ms":…}` |
| La base no responde (o tarda más de 5 s) | **`503`** · `{"status":"error","database":"unreachable"}` |
| El proceso está muerto | No hay respuesta — el monitor lo lee como caída |

### Configuración paso a paso

1. Crear cuenta gratuita en **https://uptimerobot.com** (plan free: 50 monitores, chequeo cada 5 min).

2. **Add New Monitor**:

   | Campo | Valor |
   |---|---|
   | Monitor Type | `HTTP(s)` |
   | Friendly Name | `Indians — Backend` |
   | URL | `https://<tu-backend>.up.railway.app/health` |
   | Monitoring Interval | `5 minutes` |

   En **Advanced**, si está disponible: marcar como caído a partir de `200` únicamente. Así el `503` de base caída también dispara la alerta.

3. **Alert Contacts** — crear dos:

   **a) Mail**
   - Type: `E-mail` → la dirección donde querés recibirlo.
   - Verificar el mail de confirmación que manda UptimeRobot.

   **b) WhatsApp (vía CallMeBot)** — ver el setup de CallMeBot más abajo.
   - Type: `Webhook`
   - URL to Notify:
     ```
     https://api.callmebot.com/whatsapp.php?phone=TU_NUMERO&apikey=TU_APIKEY&text=*Indians*%20*monitorName*%20esta%20*alertTypeFriendlyName*
     ```
   - `POST value`: dejar vacío (CallMeBot espera un GET).
   - UptimeRobot reemplaza `*monitorName*` y `*alertTypeFriendlyName*` (`Down` / `Up`) al enviar.

4. Asociar **los dos contactos** al monitor.

5. **Probar de verdad, no asumir**: pausar el servicio en Railway un minuto y confirmar que llegan el mail y el WhatsApp. Una alerta que nunca se probó no es una alerta. Reanudar y verificar que llega el aviso de recuperación.

### Recomendado: un segundo monitor para la tienda

El frontend lo sirve Donweb, no Railway: si se cae, el backend puede seguir perfecto y nadie se entera.

| Campo | Valor |
|---|---|
| Friendly Name | `Indians — Tienda` |
| URL | `https://indians.com.ar` |
| Interval | `5 minutes` |

---

## Setup de CallMeBot (WhatsApp)

Servicio gratuito, unos 3 minutos, una sola vez:

1. Agendar el contacto **+34 644 51 95 23** con cualquier nombre (ej. "CallMeBot").
2. Enviarle por WhatsApp el mensaje exacto:
   ```
   I allow callmebot to send me messages
   ```
3. Responde con tu **apikey** personal. Guardarla.
4. Probar desde el navegador:
   ```
   https://api.callmebot.com/whatsapp.php?phone=+549381XXXXXXX&text=prueba&apikey=TU_APIKEY
   ```
   El número va con código de país y sin espacios.

> **Limitación honesta.** CallMeBot es un proyecto personal gratuito, sin SLA ni soporte: si un día deja de funcionar, no hay a quién reclamar. Por eso **el mail queda siempre como canal de respaldo** — es el que tiene el dominio verificado en Resend. Si en algún momento el aviso pasa a ser crítico de verdad, la migración natural es Twilio (~USD 0,005 por mensaje).

---

## Capa 2 — Alertas internas (5xx sostenidos)

Ya implementada en el código. Cubre lo que el watchdog externo no puede ver: **el sistema responde, pero está fallando**.

- `src/utils/errorRateMonitor.ts` — cuenta los 5xx en una ventana deslizante y dispara al superar el umbral.
- `src/utils/alerts.ts` — manda el aviso por mail (Resend) y WhatsApp (CallMeBot), con cooldown.
- Enganchado en `src/middlewares/errorHandler.ts`, en los dos caminos que devuelven 5xx.

### Variables de entorno (Railway)

| Variable | Default | Para qué |
|---|---|---|
| `ALERT_EMAIL_TO` | *(vacío: no manda mail)* | Destinatario de las alertas |
| `CALLMEBOT_PHONE` | *(vacío: no manda WhatsApp)* | Tu número con código de país, ej. `+549381XXXXXXX` |
| `CALLMEBOT_APIKEY` | *(vacío: no manda WhatsApp)* | La apikey del paso 3 |
| `ALERT_5XX_THRESHOLD` | `10` | Cuántos 5xx disparan la alerta |
| `ALERT_5XX_WINDOW_MINUTES` | `5` | En qué ventana se cuentan |
| `ALERT_COOLDOWN_MINUTES` | `30` | Silencio entre alertas de la misma clase |
| `ALERTS_ENABLED` | *(activo)* | `0` para apagar todo sin tocar código |

Si falta la configuración de un canal, ese canal se omite en silencio: se puede arrancar sólo con mail y sumar WhatsApp después sin tocar nada.

### Decisiones de diseño

- **Nunca lanza.** Una alerta que falla no puede tumbar la request que la originó.
- **Cooldown de 30 min por clave.** Sin esto, una falla sostenida manda cientos de mensajes y el ruido logra que se ignore justo la alerta que importaba.
- **La ventana se limpia al alertar**, para no re-disparar con cada 5xx siguiente.
- **Contador en memoria, no en base.** Si el problema es que la base no responde, un contador que necesita escribir en ella no serviría de nada. La contra: con varias réplicas cada una cuenta por su lado — hoy corre una sola (condición C4); si eso cambia, revisar el umbral.
- **Apagado bajo Jest**, para que la suite no mande mails ni WhatsApps reales.

Cubierto por `src/__tests__/api/alerts.test.ts` (4 tests: umbral, no-disparo por debajo, no re-disparo, y re-disparo con una tanda nueva).

---

## Lo que esto NO cubre

Para que quede explícito y no se confunda con una cobertura que no existe:

- ~~**Jobs programados que fallan** → se loguean, no avisan.~~ **RESUELTO el 2026-08-19** (hallazgo D-02): los tres jobs pasan por `runScheduledJob` (`src/jobs/scheduler.ts`), que alerta con una `key` propia por job —para que el cooldown corra por separado— e incluye en el mensaje el impacto concreto de que ese job no corra. Importa sobre todo `reconcilePayments`: con el webhook de MercadoPago deshabilitado es el único camino por el que se acreditan los pagos. Cubierto por `src/__tests__/api/job-alerts.test.ts`.
- ~~**Plata que no llega a la caja** → sólo queda en el log y en el job diario de inconsistencias.~~ **PARCIALMENTE RESUELTO el 2026-08-19**: `reportDailyInconsistencies` ahora manda **una** alerta con el resumen cuando encuentra algo (incluye "pedidos pagados sin asiento en caja/banco"). Una sola y no seis, a propósito: seis mensajes de madrugada se ignoran en bloque. **Sigue faltando** conectar los checks 14 a 18 de `auditoria-integridad-preprod.sql`, que son más finos que lo que mira el job.
- **Degradación de rendimiento** (el sistema responde, pero lento).
- **Certificado SSL por vencer** → UptimeRobot lo avisa en sus planes pagos.

---

## Verificación (checklist de C7)

- [ ] Monitor de backend creado en UptimeRobot, apuntando a `/health`
- [ ] Monitor de la tienda creado
- [ ] Contacto de mail verificado
- [ ] CallMeBot configurado y probado desde el navegador
- [ ] Webhook de WhatsApp asociado a los monitores
- [ ] **Prueba real**: servicio pausado en Railway → llegan mail y WhatsApp → reanudado → llega el aviso de recuperación
- [ ] Variables `ALERT_EMAIL_TO`, `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` cargadas en Railway
- [ ] Prueba de la capa interna: forzar 5xx repetidos y confirmar que llega el aviso
