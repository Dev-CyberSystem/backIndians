# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-08-08 — Auditoría integral de preproducción

### Objetivo de la sesión

Ejecutar una auditoría técnica, funcional, operativa y de seguridad de **todo** el sistema antes de la salida a producción de la semana que viene, con veredicto formal `GO` / `GO CONDICIONADO` / `NO-GO`.

**Veredicto emitido: `GO CONDICIONADO PARA PRODUCCIÓN`** (7 condiciones operativas, ninguna de código).

Informe completo: **`backIndians/documentos/AUDITORIA_INTEGRAL_PREPRODUCCION_2026-08-08.md`**.

### Qué se hizo

1. **Puertas de calidad**: typecheck backend (0 errores), build de producción del frontend (exit 0), Vitest (47 tests), Jest backend (44 suites / 289 tests como línea base).
2. **Migraciones desde cero** en base descartable (`textil_audit_fresh`): todas aplicadas sin error hasta la `095`.
3. **Comparación esquema migrado vs. `sync()`**: script ad-hoc sobre las 50 tablas → **0 columnas de diferencia**. Es el riesgo que `CLAUDE.md` marca como crítico y está sano. Diferencias residuales menores documentadas como AUD-07/08/14.
4. **Backup + restauración verificados** (`mysqldump` → base nueva → conteos idénticos en las tablas críticas). Valida el *procedimiento*; el backup productivo sigue sin probarse.
5. **15 diagnósticos de integridad de solo lectura**, entregados en `backIndians/documentos/auditoria-integridad-preprod.sql`: sin inconsistencias reales.
6. **Tres hallazgos P1 encontrados, demostrados fallando, corregidos y cubiertos con tests de regresión** (ver abajo).
7. **Confrontación con auditorías previas**: se verificó que CASH-MA-001, CASH-MUT-001, CASH-VAL-004/005, C-5, C-6 y el gate de AFIP están efectivamente corregidos en el código de hoy.

### Correcciones aplicadas (sin commitear, quedan en el working tree)

| ID | Sev. | Qué era | Archivo |
|---|---|---|---|
| **AUD-01** | P1 | Un comprador podía escribir una dirección en la cuenta de **otro** comprador (`customer_id` llegaba por el body y Sequelize lo aplicaba) | `store.auth.service.ts` |
| **AUD-02** | P1 | `PUT /stock/:id` reescribía `current_quantity` **sin generar movimiento** — el mismo defecto que C-5, pero en el stock de materiales en vez del de catálogo | `stock.service.ts` |
| **AUD-03** | P1 | Cambiar/resetear la contraseña de un usuario interno **no revocaba sus sesiones**: el refresh token de 7 días seguía sirviendo | `user.service.ts`, `auth.service.ts` |
| **AUD-06** | P2 | El frontend estático se servía sin ninguna cabecera de seguridad (helmet sólo cubre la API) | `frontIndians/public/.htaccess` |

Tests de regresión nuevos: `backIndians/src/__tests__/api/audit-preprod-regressions.test.ts` (4 tests).
**Suite completa post-corrección: 45 suites / 293 tests, todo en verde.**

### Condiciones para el `GO` (todas operativas, ninguna de código)

`C1` configurar `MP_WEBHOOK_SECRET` y volver el chequeo a fatal (cierra `DEC-014`) · `C2` reconfirmar las cuentas de caja de la tienda · `C3` backup productivo **restaurado** y comprobado · `C4` una sola réplica durante las migraciones · `C5` probar el `.htaccess` nuevo en el hosting real · `C6` decidir sobre HSTS · `C7` monitoreo y alertas mínimas.

Detalle, responsable y prueba de cumplimiento de cada una: sección 9 del informe.

### Pendientes que quedan abiertos

- **`DEC-014` sigue sin cerrar** (es la condición C1). Mientras tanto los webhooks de MP se rechazan y los pagos de la tienda se acreditan por el job de reconciliación, con hasta ~10 min de demora. Verificado que en catálogo el webhook sólo escribe un campo informativo, así que el impacto ahí es mínimo.
- **No hay alertas** (AUD-05). El job diario de inconsistencias sólo loguea. Es el hueco que explica el incidente del 2026-08-07.
- **Lint del frontend: 160 errores preexistentes.** Ninguno es un bug de runtime (57 son de hot-reload, 48 de `any`), pero con ese ruido un error nuevo pasa desapercibido.
- **La tabla `products` no tiene migración** (AUD-07): `GET /api/v1/products` daría 500 en una base migrada desde cero. El frontend no lo consume.
- Backlog completo P2/P3 (AUD-04 a AUD-14): sección 5 del informe.

### Advertencias para la siguiente sesión

- **Nada fue commiteado ni desplegado.** Los cambios de las 4 correcciones están en el working tree de ambos repos, sin `git add`.
- Las bases de auditoría (`textil_audit_fresh`, `textil_restore_test`) y el dump temporal **se eliminaron** al terminar. La base de desarrollo `textil_db` quedó sembrada y con los datos que dejó la suite.
- **No se tocó producción** en ningún momento de esta auditoría.
- No se corrieron los E2E de Playwright ni pruebas de carga — la cobertura de flujos vino de las 45 suites de API.
- Se respetó la regla de no leer `.env*` ni `Users.txt`: la verificación de variables se hizo comprobando *presencia y longitud*, nunca imprimiendo valores.

---

## Actualizar este documento cuando…

Termine cualquier sesión de trabajo no trivial. Reemplazar completamente la sección "Última actualización" por la de la sesión nueva (no acumular secciones viejas — para historial, usar git log y 08-DECISIONS.md).
