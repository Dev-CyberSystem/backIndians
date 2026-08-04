# Avance — Corrección Módulo Tienda Online (Indians)

Seguimiento de la implementación del plan de `AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md`.
Convención: pendiente / en curso / resuelto / descartado.

> **Nota de estructura de repos:** `indians/` (raíz) no es un repositorio git
> funcional. `backIndians` y `frontIndians` son **dos repos git separados**
> (remotos `Dev-CyberSystem/backIndians` y `Dev-CyberSystem/frontIndians`),
> ambos en la branch `fixauditoria`. Este documento (`documentos/`) vive fuera
> de ambos repos y no queda versionado salvo que se decida moverlo o trackear
> la raíz.

---

## Fase 1 — Correcciones críticas

| Tarea | Hallazgo(s) | Estado | Nota |
|---|---|---|---|
| 1.7 | C-4 (parcial) | **Resuelto** | Ver detalle abajo. |
| 1.9 | Higiene de secretos | **Resuelto (parcial — ver riesgo residual)** | Ver detalle abajo. |
| 1.1 | C-2, C-3 | **Resuelto (código) — pendiente acción manual** | Ver detalle abajo. |
| 1.2 | C-5 | Pendiente | — |
| 1.3 | C-1, A-9 | Pendiente (depende de 1.2, 1.10) | — |
| 1.10 | M-8 | Pendiente (habilita 1.3) | — |
| 1.4 | A-1 | Pendiente | — |
| 1.5 | A-7 | Pendiente (depende de 1.1) | — |
| 1.6 | C-6, A-3, A-4 | Pendiente | — |
| 1.8 | C-8 (parcial) | Pendiente (depende de 1.1) | — |

---

### 1.7 — Renombrar "factura" → "comprobante de compra"

**Estado: Resuelto.**

Archivos tocados (`backIndians`): `src/utils/store.pdf.ts`, `src/utils/email.service.ts`,
`src/controllers/store.controller.ts`, `src/services/store.service.ts` (comentario de sección).
Archivos tocados (`frontIndians`): `src/pages/ecommerce/EcommerceOrdersPage.tsx`,
`src/pages/store/StoreAccountPage.tsx`.

- Título del PDF: `FACTURA` → `COMPROBANTE`.
- Reemplazado el bloque de CAE/"Comprobante autorizado por ARCA" (que era una
  afirmación falsa) por la leyenda **"Documento no válido como factura"** +
  aclaración de que no reemplaza a la factura fiscal.
- Asunto/cuerpo del email, nombre de archivo adjunto (`factura-*.pdf` →
  `comprobante-*.pdf`), mensajes de respuesta del backend y textos/labels del
  panel admin y de "Mi cuenta" en la tienda: todos renombrados.
- Identificadores internos (`sendOrderInvoiceEmail`, `downloadInvoice`,
  endpoints `/invoice`, `/send-invoice`, variable `INVOICE_STATUSES`) se
  dejaron sin tocar a propósito — no son texto de cara al cliente y renombrarlos
  no aporta nada a este hallazgo.

**Decisión de alcance (no pedida explícitamente, la tomé por consistencia con
la razón de ser de C-4):** además de la leyenda, reemplacé el texto
"Comprobante autorizado por ARCA" (que es una afirmación falsa hoy) por la
misma leyenda de descargo. No toqué el resto del layout tipo-factura (casillero
con la letra X/A/B/C, numeración `punto de venta-nro`, discriminación de IVA,
casillero QR) — eso es un rediseño más de fondo y corresponde a la Fase 2
(`store_invoices`), no a un cambio de "muy bajo riesgo".

**Verificación:** `grep -i factura` sobre los 5 archivos no devuelve ningún
texto de cara al cliente (solo aparece dentro de la leyenda misma y en
comentarios internos). `npm run typecheck` (backend) y `npx tsc --noEmit`
(frontend) limpios.

**Hallazgo de lint preexistente (no introducido por esta tarea):**
`npx eslint src --max-warnings=0` en `frontIndians` ya fallaba antes de este
trabajo — 162 errores / 11 warnings en todo el proyecto (hooks condicionales,
`any`, escapes innecesarios, etc.), ninguno en las líneas que edité. No lo
corregí porque está fuera del alcance de 1.7 y tocar esos archivos (algunos
con reglas de hooks rotas) es un cambio de mayor riesgo que amerita su propia
tarea. Lo dejo marcado para que decidas si entra en el plan.

---

### 1.9 — Higiene de secretos (`.env.bak`)

**Estado: Resuelto en el índice de git — riesgo residual en el historial.**

- `.env.bak` estaba trackeado en el repo `backIndians` (`git ls-files` lo
  confirmaba) y el `.gitignore` solo excluía `.env` exacto, no `.env*`.
- Hice `git rm --cached .env.bak` (queda **sin trackear pero sigue en tu
  disco** — no borré el archivo físico, por si lo necesitás antes de rotar
  credenciales).
- Actualicé `backIndians/.gitignore`: agregué `.env.*` con excepción
  `!.env.example`, para que ningún `.env.*` futuro (bak, local, etc.) se
  vuelva a versionar por error.
- **No hice commit** — dejé el `git rm --cached` y el `.gitignore` en el
  working tree para que los revises antes de commitear.

**Riesgo residual importante:** sacar el archivo del commit actual **no lo
borra del historial git**. Hay un commit (`05faa4f "integracion mp"`) que
todavía lo contiene y sigue siendo recuperable con `git show
05faa4f:.env.bak` por cualquiera con acceso al repo remoto. Purgar el
historial (`git filter-repo` / BFG + force-push) es una operación destructiva
que reescribe la historia compartida — **no la hice** sin tu autorización
explícita. La mitigación real es rotar las credenciales, no depender de
borrar el historial.

**Variables que contenía `.env.bak` (nombres únicamente, sin valores) —
rotalas si son las reales de producción:**

```
PORT, NODE_ENV, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN,
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
FRONTEND_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
MP_ACCESS_TOKEN, MP_PUBLIC_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL,
STORE_URL, GOOGLE_CLIENT_ID
```

Prioridad de rotación sugerida: `DB_PASSWORD`, `JWT_SECRET` /
`JWT_REFRESH_SECRET`, `MP_ACCESS_TOKEN`, `CLOUDINARY_API_SECRET`,
`RESEND_API_KEY`, `SMTP_PASS`, `GOOGLE_CLIENT_ID` (si tiene client secret
asociado en otro lado).

---

### 1.1 — Configuración de MercadoPago (webhook)

**Estado: Resuelto en código — falta acción manual tuya en Railway/panel de MP.**

- `backIndians/.env.example`: `BACKEND_PUBLIC_URL` ya estaba documentada
  (dato que corrige a la auditoría original). Agregué `MP_WEBHOOK_SECRET` con
  comentario explicando dónde se genera y para qué sirve.
- `backIndians/src/server.ts` — `validateEnv()`: si `NODE_ENV=production` y
  falta `BACKEND_PUBLIC_URL` (o apunta a localhost/127.0.0.1) o falta
  `MP_WEBHOOK_SECRET`, el arranque falla con `process.exit(1)` y un log
  `startup.envValidation` con el detalle de qué falta.
- `backIndians/src/services/mercadopago.service.ts` —
  `verifyWebhookSignature()`: ahora es **fail-closed en producción** (sin
  secret configurado, rechaza todo). Fuera de producción sigue siendo
  permisivo si no hay secret, pero ahora loguea un WARN
  (`mercadopago.webhookSecretMissing`) en vez de fallar en silencio.
- `backIndians/src/middlewares/rateLimit.ts`: nuevo `webhookLimiter` (30
  req/min por IP).
- `backIndians/src/routes/store.routes.ts`: `POST /webhook/mp` ahora pasa por
  `webhookLimiter` además del `generalLimiter` global.

**Tests:** `src/__tests__/unit/mercadopago.service.test.ts` (nuevo, 6 casos,
sin DB) — cubre fail-closed en producción sin secret, fail-open en dev sin
secret, firma válida, firma inválida, sin header `x-signature`, y `dataId`
que no coincide con el firmado. Los 6 pasan (`npx jest
src/__tests__/unit/mercadopago.service.test.ts`).

**Verificación:** `npm run typecheck` (backend) limpio.

**Acción manual tuya (no la puedo hacer yo):**
1. En el panel de MercadoPago (Tu aplicación → Webhooks) generar la "Firma
   secreta" y copiarla.
2. En Railway, variables del backend: setear `MP_WEBHOOK_SECRET` (el valor
   del punto anterior) y `BACKEND_PUBLIC_URL` (dominio público real del
   backend, sin localhost).
3. Sin esas dos variables seteadas, **el backend no va a arrancar en
   producción** a partir de este cambio (`NODE_ENV=production` + falta
   cualquiera de las dos → `process.exit(1)`). Conviene setearlas *antes* de
   desplegar este cambio para no causar una caída del servicio.

---

## Preguntas / decisiones pendientes de tu parte

1. ¿Confirmás que puedo seguir con **1.2 (ledger de stock)** como próxima
   tarea, o preferís reordenar?
2. `documentos/` no está versionado en ningún repo git — ¿querés que lo mueva
   a `backIndians/` o `frontIndians/`, o que inicialice un repo en la raíz
   para trackearlo, o lo dejamos así (sin versionar)?
3. ¿Confirmás el `git rm --cached .env.bak` + cambio de `.gitignore` para que
   los commitee, o preferís revisarlo vos primero?
4. Los 162 errores/11 warnings preexistentes de ESLint en `frontIndians`:
   ¿los dejamos para una tarea de limpieza aparte (Fase 4, ítem 4.1/4.8) o
   querés que los mire antes?
