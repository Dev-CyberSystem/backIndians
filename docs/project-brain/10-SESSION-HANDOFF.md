# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-08-19 — Textos legales de la tienda (cierra B-03 de la auditoría del 2026-08-18)

### Objetivo de la sesión

Escribir los textos legales exigidos por la normativa argentina de comercio electrónico y dejar **constancia registrada** de su aceptación. Ataca directamente el bloqueante **B-03** de la auditoría del 2026-08-18 ("sin política de privacidad, términos, botón de arrepentimiento ni Data Fiscal; el registro afirma que se aceptan términos inexistentes").

Rama: **`feature/textos-legales`** en los dos repos (creada desde `master`).

### Qué se hizo

**Textos (frontend, `frontIndians/src/pages/store/legal/`)**

- `/tienda/legal/terminos` — Términos y Condiciones (19 secciones): identificación del titular (Res. 104/2005), precios en pesos con precio final (Decreto 274/2019), perfeccionamiento del contrato, envíos, **derecho de revocación a 10 días** con la excepción del art. 1116 CCyCN para prendas personalizadas, garantía legal (arts. 11-17 Ley 24.240), jurisdicción del **domicilio del consumidor** (art. 1109 CCyCN) y vías de reclamo (Ventanilla Única Federal).
- `/tienda/legal/privacidad` — Política de Privacidad (Ley 25.326): qué datos, finalidad, carácter obligatorio/facultativo, destinatarios (MercadoPago, Google, Cloudflare, Resend, Cloudinary, correos, hosting), transferencia internacional (art. 12), plazos de respuesta de acceso/rectificación, y las dos leyendas textuales vigentes (art. 14 inc. 3 y la del órgano de control según **Resolución 14/2018 de la AAIP**, que derogó la Disposición 10/2008 — la leyenda vieja "DIRECCIÓN NACIONAL…" ya no corresponde).
- `/tienda/legal/arrepentimiento` — botón de arrepentimiento con formulario real (Res. 424/2020): sin login, sin captcha, código `ARR-AAAA-NNNNNN` en pantalla y por mail. Link destacado en el footer de toda la tienda + alias `/tienda/arrepentimiento`.
- **Data Fiscal (F. 960/D)**: componente en el footer que se muestra solo si está cargada la URL del QR de ARCA (`store_data_fiscal_url`, nueva clave de Settings, editable en Tienda online → Configuración).
- Los datos del titular (razón social, CUIT, domicilio, condición IVA, contacto) **no están escritos en los textos**: salen de `company_*` en Settings.

**Constancia de aceptación (backend)**

- Tablas nuevas `legal_acceptances` y `store_withdrawal_requests` + columnas `store_customers.terms_accepted_at` / `terms_version` (migraciones **096, 097, 098**; replicadas en `ensureSchema.ts` → `ensureLegalSchema()`, llamada desde `server.ts`).
- `accept_terms` **obligatorio** en `POST /store/auth/register` y `POST /store/checkout`; en el checkout la constancia se escribe dentro de la transacción del pedido. Ver `BR-LEGAL-001` a `BR-LEGAL-004` en [03-BUSINESS-RULES.md](03-BUSINESS-RULES.md).
- Panel: **Tienda online → Legales** (`/ecommerce/legal`) — gestión de arrepentimientos (estado + notas + vínculo al pedido) y búsqueda de constancias por email.

### Validación

- Backend: `tsc --noEmit` limpio · **Jest 48 suites / 325 tests en verde**, incluidas las 12 nuevas de `src/__tests__/api/legal.test.ts`.
- Frontend: `tsc -b` limpio · Vitest 47/47 · `npm run build` OK · ESLint limpio en los archivos nuevos (el resto del repo sigue con los 168 errores preexistentes).
- E2E: se agregó el paso de tildar la aceptación en los tres flujos que compran o se registran (`acceptLegalTerms` en `e2e/tests/utils.ts`). **No se corrió Playwright en esta sesión.**
- Se corrigió `findPurchasable` (helper de tests) para descartar productos con precio inválido: un producto basura de otro test hacía fallar `purchase-flow` de forma intermitente.

### Riesgos y pendientes

1. **Cambio de contrato de API**: backend y frontend tienen que desplegarse **juntos**. El frontend viejo contra el backend nuevo no puede comprar ni registrarse (422). Recordar que push a `master` del backend despliega solo en Railway.
2. **Pendiente operativo del negocio, no de código**: cargar en Settings la razón social, CUIT, domicilio, condición IVA y email reales (hoy los textos muestran "—"), y pegar la URL del QR de Data Fiscal que genera ARCA. Sin eso, los textos están publicados pero incompletos frente a la Res. 104/2005 y la RG 4042-E.
3. **A definir con un profesional**: inscripción de la base de datos ante la AAIP (art. 21 Ley 25.326, Res. 132/2018) y revisión de los textos por un abogado — lo entregado es un articulado completo y fundado en la normativa vigente, pero no reemplaza una revisión legal.
4. **Cruce con S-01** (auditoría 2026-08-18: `/store/settings` expone las 75 claves): cuando se cierre con una allowlist, tienen que seguir siendo públicas `company_name`, `company_cuit`, `company_address`, `company_email`, `company_iva_condition` y `store_data_fiscal_url` — los textos legales las leen desde ahí.
5. **L-01 sigue abierto**: la política de privacidad informa el derecho de supresión, pero no existe `DELETE /me` ni purga de `store_events`. Es la brecha más visible entre lo que el texto promete y lo que el sistema hace.
6. Del resto de los bloqueantes de la auditoría, esta sesión **solo** cierra B-03. B-01 (productos de prueba), B-02 (transferencia sin CBU) y el resto siguen igual.

### Cómo retomar

1. `git checkout feature/textos-legales` en ambos repos y revisar los textos con el titular del negocio antes de mergear.
2. Cargar los datos fiscales en el panel (Configuración → empresa) y la URL de Data Fiscal, y recién ahí mergear y desplegar los dos repos juntos.
3. Correr los E2E de Playwright contra el entorno local para validar el nuevo checkbox en el flujo real de navegador.

---

## Actualizar este documento cuando…

Termine cualquier sesión de trabajo no trivial. Reemplazar completamente la sección "Última actualización" por la de la sesión nueva (no acumular secciones viejas — para historial, usar git log y 08-DECISIONS.md).
