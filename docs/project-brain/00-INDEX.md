# 00 — Índice del cerebro documental (Indians)

> Última actualización: **2026-08-19 (noche)** — pagos de MercadoPago del catálogo (acreditación real, métricas facturado≠cobrado, aviso automático): se actualizaron 03 (BR-CATALOG-001/002), 06, 08 (DEC-019, DEC-020), 09 (sección nueva) y 10. Antes, esa misma tarde, el cierre de la auditoría de panel actualizó 03, 06, 07, 08 (DEC-015 a DEC-018), 09, 10 y 11. El resto sigue siendo la fotografía del 2026-08-05.
> Generado por auditoría completa del código real (no de intenciones ni de nombres de archivos). Ver metodología y limitaciones en cada documento.

## Estado general del proyecto (resumen de 1 párrafo)

Indians es un sistema de gestión textil (fábrica de indumentaria deportiva a pedido) con un módulo adicional de tienda online B2C. El sistema de gestión (pedidos, stock, facturación, caja, catálogo mayorista, costos) está maduro y en uso activo. La tienda online pasó recientemente por una auditoría de seguridad/consistencia en dos fases (ambas cerradas, con ~199 tests en verde) y quedó con un único pendiente grande: integración con el courier Andreani (sin empezar). La facturación electrónica AFIP/ARCA está implementada en código y commiteada, pero **deshabilitada en producción** por falta de certificado real. No hay CI/CD. Ambos repos (`backIndians`, `frontIndians`) están en la rama `fixauditoria`, limpios (sin cambios sin commitear) a la fecha de esta auditoría.

## Qué contiene cada documento

| Documento | Contenido | Cuándo consultarlo |
|---|---|---|
| [01-PROJECT-OVERVIEW.md](01-PROJECT-OVERVIEW.md) | Qué es el proyecto, para quién, qué problema resuelve, tipos de usuario, glosario de negocio | Primera lectura en toda sesión nueva; para entender contexto de negocio antes de tocar cualquier módulo |
| [02-FUNCTIONAL-MAP.md](02-FUNCTIONAL-MAP.md) | Cada módulo funcional (pedidos, stock, caja, catálogo, tienda, costos, AFIP, etc.): objetivo, usuarios, flujo principal, estados, nivel real de implementación | Antes de implementar/modificar una funcionalidad de un módulo específico |
| [03-BUSINESS-RULES.md](03-BUSINESS-RULES.md) | Reglas de negocio verificadas en código, con ID (`BR-XXX-NNN`), fuente y estado | Antes de cambiar cualquier lógica que afecte cálculos, transiciones de estado, stock, pagos o permisos |
| [04-ARCHITECTURE.md](04-ARCHITECTURE.md) | Stack, estructura de carpetas, comunicación frontend↔backend, auth, manejo de errores, patrones | Antes de agregar un endpoint, un modelo, una página, o de tocar infraestructura transversal (logging, auth) |
| [05-DATABASE.md](05-DATABASE.md) | Motor, tablas por dominio, migraciones (91, resumidas), índices, inconsistencias detectadas | Antes de crear/alterar una migración o modelo Sequelize |
| [06-API-AND-INTEGRATIONS.md](06-API-AND-INTEGRATIONS.md) | Endpoints por router con roles requeridos, integraciones externas (AFIP, MercadoPago, Resend, Cloudinary, Andreani), variables de entorno por nombre | Antes de consumir/agregar un endpoint o integrar un servicio externo |
| [07-DEVELOPMENT-GUIDE.md](07-DEVELOPMENT-GUIDE.md) | Cómo instalar, correr, testear, buildear y depurar el proyecto | Al empezar a trabajar en el entorno local o al depurar un problema de entorno |
| [08-DECISIONS.md](08-DECISIONS.md) | Registro de decisiones técnicas/funcionales con motivo y alternativas descartadas (cuando están documentadas) | Antes de proponer revertir o cuestionar una decisión ya tomada |
| [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md) | Qué está terminado/parcial/pendiente, deuda técnica, riesgos, próximos pasos recomendados | Al planificar qué hacer a continuación |
| [10-SESSION-HANDOFF.md](10-SESSION-HANDOFF.md) | Entrega entre sesiones: qué se hizo la última vez, qué falta, cómo retomar | Al empezar y al terminar cada sesión de trabajo importante |
| [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md) | Cómo preparar un release versionado, deployarlo y volver atrás si falla (los tres planos del rollback: frontend, backend, base) | Antes de subir cualquier cosa a producción, y con urgencia cuando algo ya se rompió |

## Cómo usar este cerebro (regla operativa)

1. Leé este índice primero.
2. Leé **solo** los documentos relacionados con la tarea puntual (no todo el cerebro completo salvo que la tarea sea transversal).
3. Verificá el estado real del código antes de asumir que algo descrito acá sigue vigente — este documento es una fotografía al 2026-08-05, el código puede haber cambiado después.
4. Si la tarea cambia una funcionalidad, arquitectura, regla de negocio o decisión documentada acá, actualizá el documento correspondiente al terminar (ver `CLAUDE.md` en la raíz para el detalle del proceso).

## Convenciones usadas en este cerebro

- **Estado de implementación**: `Implementado y verificado` / `Implementado parcialmente` / `Planificado, no implementado` / `Desconocido, pendiente de confirmar`.
- **Trazabilidad**: cada afirmación técnica relevante cita archivo (y línea cuando aporta), modelo, migración, endpoint o commit. Si no hay fuente citable, se marca explícitamente como no verificado.
- **Dos repos, no uno**: `backIndians/` y `frontIndians/` son repositorios git independientes (remotos `Dev-CyberSystem/backIndians` y `Dev-CyberSystem/frontIndians`). La carpeta raíz `indians/` que los contiene **no es un repo git funcional** — es solo un directorio de trabajo local. `backIndians/docs/project-brain/` y `CLAUDE.md` viven en esa raíz para cubrir ambos repos desde un solo lugar, pero no quedan versionados por git hasta que cada repo decida incluirlos (ver nota en 09-CURRENT-STATUS.md).
- Idioma: toda la documentación de este cerebro está en español, igual que el resto de la documentación del proyecto (`backIndians/documentos/`, `backIndians/docs/`).
