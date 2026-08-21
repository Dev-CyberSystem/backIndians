# Changelog

Releases coordinados de `backIndians` + `frontIndians`. Generado por `npm run release`.
Cada versión corresponde a un tag `vX.Y.Z` presente en **ambos** repos.

## v1.0.5 — 2026-08-21

### backIndians (78b09b8)

- feat(catalogo): refrescar el cobro contra MercadoPago a demanda

### frontIndians (3129043)

- feat(catalogo): la pantalla del QR se cierra sola al entrar el pago

## v1.0.4 — 2026-08-20

### backIndians (5454927)

- fix(catalogo): acreditar pagos de MercadoPago y separar facturado de cobrado
- docs(release): los comandos del runbook pasan a PowerShell

### frontIndians (f725209)

- fix(catalogo): avisar en el panel cuando impacta un pago de MercadoPago

## v1.0.3 — 2026-08-20

### backIndians (1f8189a)

- fix(mp): MP_WEBHOOK_SECRET vuelve a ser fatal en produccion

### frontIndians (faa1a47)

- sin cambios desde el release anterior

## v1.0.2 — 2026-08-20

### backIndians (6eea89a)

- docs(auditoria): tercera pasada del panel de seis roles (post-correccion)
- feat(health): exponer si MP_WEBHOOK_SECRET esta cargado, y avisar cuando el arrepentimiento no llega al admin

### frontIndians (3430d18)

- sin cambios desde el release anterior

## v1.0.1 — 2026-08-19

### backIndians (6b9b2d6)

- docs(project-brain): registrar el cierre de los hallazgos de la auditoría del 2026-08-19
- fix(tienda): rechazar transferencia sin datos bancarios y cubrir la constancia de arrepentimiento
- fix(seguridad): allowlist en settings públicos, contraseñas más largas, ensureSchema fuera de prod y alertas de jobs
- docs: agregar los informes de auditoría del 18 y 19 de agosto y el prompt de corrección
- fix(release): verificar de verdad los backups y sincerar la herramienta de SQL
- fix(tests): devolver la suite a verde tras desactivar el pago en efectivo
- Desactivar pago en efectivo en checkout de tienda online
- docs(project-brain): registrar las mejoras posteriores y el drift resultante
- feat(release): npm run prod, --from en rollback y detección de drift de commit
- docs(project-brain): cerrar la sesión del sistema de releases con v1.0.0 en producción

### frontIndians (d01bdcf)

- fix(tienda): ocultar la transferencia bancaria cuando no hay datos cargados (B-02)
- fix(seguridad): mínimo de contraseña a 10 caracteres, nanoid parchado y camino muerto de efectivo documentado
- Desactivar pago en efectivo en checkout de tienda online

## v1.0.0 — 2026-08-19

### backIndians (a20b676)

- fix(release): no confundir renormalización de fin de línea con cambios reales
- fix(release): git sin shell en Windows + reversión completa del release parcial
- feat(release): flag --yes para confirmación no interactiva
- feat(release): sistema de releases versionados con backup y rollback
- Legales de tienda: constancia de aceptación y botón de arrepentimiento
- fix(pedidos): el checklist de control ya no bloquea el avance de estado
- fix(tests+mail): guarda de envio de mails, fragilidad horaria y reset de base
- docs(auditoria): C5 cerrada — .htaccess verificado en produccion tras el deploy
- feat(monitoreo): health con chequeo de base + alertas de 5xx por mail y WhatsApp (C7)
- docs(auditoria): arreglar la fila C8 fuera de tabla y la ruta de e2e
- chore(docs): versionar el cerebro documental y CLAUDE.md en backIndians
- docs(auditoria): e2e ya versionada en frontIndians; queda docs/project-brain sin versionar
- docs(auditoria): cerrar C8, corregir AUD-16 y registrar los E2E corridos
- docs(auditoria): SQL de integridad v2 — 28 checks, criterio unico, ejecutado (REV-02/03/06)
- fix(auth): session_version con increment atomico + tests faltantes (REV-01/04/05)
- _(primer release: sólo se listan los últimos 15 commits)_

### frontIndians (36dc6fc)

- feat(release): publicar version.json y soportar deploy de snapshots
- Textos legales de la tienda: T&C, privacidad, arrepentimiento y Data Fiscal
- feat(tienda): tipografia de marca con placeholder Poppins mientras no haya licencia de Proxima Nova
- fix(pedidos): el checklist de control ya no es obligatorio para avanzar
- fix(tienda): actualizar categorías del menú a Hombre, Mujer, Niños, Fútbol, Vóley, Básquet y Running
- fix(tienda): menú mobile muestra subcategorías al tocar la categoría
- chore(e2e): versionar la bateria de Playwright dentro de frontIndians
- fix(catalogo): mostrar el motivo real del error al guardar talles (C8)
- fix(seguridad): cabeceras de seguridad y cache en .htaccess (AUD-06)
- fix: no permitir agregar al carrito ni pagar productos con precio invalido
- fix(a11y): label "Medio de pago" en los selectores de cobro + npm audit fix
- feat(caja): UI de cobranza con medio de pago e Idempotency-Key (Fase 2)
- fix(caja): rotular el criterio de neteo en las tarjetas del resumen
- fix(caja): alinear la UI con las nuevas reglas de integridad del backend
- fix(caja): reflejar en la UI las correcciones P0 de la auditoria
- _(primer release: sólo se listan los últimos 15 commits)_
