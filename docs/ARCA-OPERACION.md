# ARCA — operación y puesta en marcha

## Estado operativo local — 2026-09-14

Se cargaron exclusivamente para homologación el certificado y la clave local del alias `IndiansQA`. El par coincide, corresponde a la CUIT `20-29323025-1` y está vigente hasta el 13/09/2028. La constancia de opción aportada confirma como titular fiscal a `CARRILLO LEITO GONZALO SEBASTIAN`, domicilio General Paz 1071 Piso 4 Dpto. C, San Miguel de Tucumán, CP 4000, Monotributo categoría F e inicio 01/08/2026. El usuario confirmó que IIBB no corresponde y el setting quedó como `No corresponde`.

Para preparar producción se validaron dos certificados `IndiansProd`, ambos emitidos por la AC productiva de ARCA para la CUIT correcta, vigentes hasta el 14/09/2028 y coincidentes con la clave privada. Se seleccionó localmente el más reciente (`IndiansProd_2383dd0cd48d394f.crt`) en variables `_PROD`, sin versionar secretos. Después de vincular `IndiansProd` al servicio `wsfe`, el preflight productivo de solo lectura autenticó ambos certificados. WSFE confirmó Factura C y Consumidor Final, punto de venta 3 activo (`CAE - Monotributo`, no bloqueado) y último número autorizado 0. No se solicitó CAE ni se emitió un comprobante productivo. La configuración local permanece en `afip_environment=homo` y `afip_enabled=false`.

La autorización del alias `IndiansQA` a `wsfe` quedó operativa: WSAA autenticó y WSFE respondió para la CUIT representada. `FEParamGetPtosVenta` devuelve 602 sin resultados en testing, pero `FECompUltimoAutorizado` acepta el punto 3 para Factura C. Por ello el código tolera ese caso exacto solo en `homo` y conserva el catálogo obligatorio en producción.

Prueba real completada el 14/09/2026: Factura C de homologación punto 3 número 1, total $121, autorizada con CAE y vencimiento 24/09/2026; luego Nota de Crédito C asociada, punto 3 número 1, por el total, también autorizada. Repetir la misma NC con su clave no generó otro comprobante. Los PDF reales fueron renderizados e inspeccionados: muestran ambiente sin validez fiscal, QR, CAE, vencimiento y asociación. El journal y el ticket cifrado quedaron persistidos localmente. No hubo llamadas a producción.

Para la prueba manual se creó la factura local borrador `ARCA-MANUAL-QA-20260914212054`, ID 392, cliente `Cliente Homologación Manual`, total $121. En el modal se debe usar Factura C, Productos, DNI `30123456` y Consumidor Final. Es una fixture local: no representa una venta ni un cliente real. La emisión local quedó deshabilitada al comenzar la preparación productiva.

Implementación en `fix/arca-facturacion-segura`, backend y frontend. Revisión 2026-09-10/11 y homologación real 2026-09-14. El usuario autorizó los ajustes fiscales y de esquema; no se desplegó ni se habilitó producción.

## Alcance

Facturas A/B/C y notas de crédito A/B/C asociadas, para fábrica, catálogo mayorista y tienda. Pesos argentinos; precios finales con una alícuota por comprobante (0%, 10,5% o 21%) o comprobante íntegramente exento. Conceptos productos, servicios y mixto; servicios requieren período y vencimiento. Identificación con CUIT válido o DNI, nombre y domicilio del receptor; no se emiten receptores anónimos.

No incluye múltiples alícuotas dentro de un comprobante, moneda extranjera, exportación, FCE MiPyME, notas de débito ni regímenes especiales. No seleccionar una alícuota general si la operación requiere un desglose diferente. Confirmar con el responsable contable el régimen, los datos del emisor y el tratamiento aplicable antes de habilitar.

## Configuración

1. Aplicar `20260910-108-create-afip-journal.js` con el procedimiento de migración del proyecto, previo backup. Crea `afip_documents` y `afip_auth_tickets`; no altera migraciones anteriores. En desarrollo, modelos registrados + `sync()` + índices en `ensureSchema.ts` producen las mismas tablas.
2. Configurar en el servidor, sin versionar valores:
   - `AFIP_CERT_BASE64_HOMO` y `AFIP_KEY_BASE64_HOMO`.
   - `AFIP_CERT_BASE64_PROD` y `AFIP_KEY_BASE64_PROD`.
   - Las variables antiguas sin sufijo solo sirven como fallback de producción. Homologación nunca las reutiliza.
3. Completar settings: `company_name` (razón social fiscal), `company_cuit`, `company_address` (domicilio fiscal), `company_iva_condition`, `company_iibb` (número o condición exenta) y `company_activity_start`.
4. Elegir `afip_environment=homo`, `afip_punto_venta` habilitado para Web Services y `afip_concepto_default`. Vincular certificado, CUIT representada y servicio WSFE según el ambiente. Verificar vigencia del certificado y reloj del servidor.
5. Habilitar emisión de homologación con `afip_enabled=true` solo al iniciar pruebas operativas. Todo acceso WSAA/WSFE conserva el gate. No hay emisión automática por cobrar un pedido.
6. Desplegar backend y frontend compatibles con el nuevo historial. Usar el flujo de release del proyecto; este trabajo no ejecutó un release.

Los tickets se conservan cifrados con AES-256-GCM, con clave derivada de la clave privada. Se reutilizan tras reiniciar y entre procesos. Una rotación de certificado cambia su identidad; no borrar tickets vigentes para forzar autenticaciones repetidas.

## Emisión y recuperación

Desde Facturas o el detalle del documento, un admin/billing abre **ARCA**, comprueba ambiente, receptor, importes y confirma. Se consulta la parametrización oficial y se persiste un snapshot antes de enviar.

Estados del historial: `prepared`, `uncertain`, `sent`, `rejected`. Los locks MySQL serializan por origen y emisor/ambiente. Un intento sin resolver bloquea otras emisiones de ese emisor.

Si se pierde una respuesta, usar **Consultar y recuperar**. Se consulta el mismo tipo, punto de venta y número, verificando receptor, fecha, montos, IVA y asociación. Solo una consulta con error 602 y numeración intacta habilita reenviar exactamente el payload reservado. Nunca se toma un número nuevo por un timeout. Si otro sistema ocupó el número con otros datos, detener y conciliar; no editar el journal para saltear el bloqueo. Evitar usar el mismo punto de venta desde aplicaciones independientes.

Conservar ambiente, CUIT y punto de venta originales para recuperar. Homologación no modifica las columnas administrativas `afip_*`; la proyección antigua se usa exclusivamente para facturas de producción. Los PDF y estadísticas se basan en el journal.

Los registros legados con `afip_status` sin snapshot quedan bloqueados para emisión productiva. Requieren comprobar el estado en ARCA y una conciliación documentada, incluso si antes figuraban como error. No se atribuyen retrospectivamente a producción u homologación. Tampoco se incluyen automáticamente en las estadísticas nuevas.

## Notas de crédito, anulaciones y reintegros

Desde una factura autorizada, **Nota de crédito** permite un ajuste parcial o total con motivo e idempotencia UUID. Se asocia al original; los créditos no pueden superar su total. Los importes acumulados cierran neto e IVA en centavos.

La anulación administrativa de una factura productiva requiere acreditar antes el saldo fiscal. La modificación de importes de fábrica se bloquea durante emisión o después del CAE; sigue disponible la edición administrativa sin cambiar importes. No se permite borrar pedidos con historial fiscal.

El reintegro efectivo de dinero se registra separadamente: no se bloquea el registro de dinero ya devuelto. El panel de Facturas muestra reintegros de tienda y anulaciones con crédito fiscal pendiente. Las notas de crédito no devuelven dinero ni revierten stock automáticamente.

## PDF y auditoría

El PDF fiscal sale exclusivamente de un snapshot autorizado y conserva emisor, receptor, detalle, impuestos, asociación, CAE, vencimiento y QR oficial. Usa el mismo formato visual que los comprobantes administrativos de Indians: membrete, marco, letra, datos del cliente, tabla, totales, firma y barra inferior. El bloque fiscal reemplaza el QR de muestra y la leyenda interna por el QR oficial, CAE y vencimiento. Los comprobantes de homologación dicen **SIN VALIDEZ FISCAL**. Sin journal productivo autorizado, el PDF administrativo conserva una advertencia de documento interno.

El snapshot incluye operador que preparó la emisión, ambiente y fecha; el resultado de ARCA se guarda antes de proyectar el estado al documento administrativo. Respaldar journal y tickets junto con la base. No eliminar estas tablas en un rollback después de emitir: deshabilitar primero la emisión y conservar evidencia y numeración.

## Validación antes de producción

Con certificados y habilitaciones reales, ejecutar en homologación los tipos aplicables al emisor: factura, consulta de la autorización, repetición sin duplicar, nota parcial y total, PDF y QR, servicios si corresponden. Verificar con el responsable contable razón social, IIBB, inicio de actividades, IVA y documentos.

Registrar CUIT, ambiente, punto de venta, tipos/números, CAE y resultado de cada caso en un acta sin secretos. El preflight productivo de credenciales, tipo de comprobante y punto de venta está aprobado. Quedan el despliegue controlado, la carga de secretos en Railway, la configuración fiscal con emisión deshabilitada y la autorización separada del primer comprobante productivo.

## Preflight productivo y ensayo de release — 2026-09-14

- WSAA producción autenticó con ambos certificados `IndiansProd`; se usará el certificado más reciente, que coincide con la clave privada y la CUIT `20-29323025-1`.
- WSFE producción confirmó Factura C, Consumidor Final y PV 3 activo. Última Factura C autorizada: 0. El primer número esperado es 1 si no existe otra emisión sobre ese punto antes del alta.
- No se solicitó CAE y no se modificaron settings ni base de producción.
- Ensayo `v1.11.2` aprobado: backend typecheck, 64 suites/497 tests; frontend 52 tests, build y 38/38 rutas prerenderizadas. El modo dry-run no creó commits, tags, backups ni despliegues.

## Referencias oficiales consultadas

- [Manual WSFEv1 ARCA v4.7, revisión 1 de septiembre de 2026](https://www.afip.gov.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf).
- [Manual WSAA](https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf).
- [Certificados y ambientes](https://www.afip.gov.ar/ws/documentacion/certificados.asp).
- [Especificación del QR](https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf).
- [Leyenda de factura A a monotributista](https://servicioscf.afip.gob.ar/publico/abc/ABCpaso2.aspx?id=5954008).
## Validación de implementación — 2026-09-11

- Backend: `npm run test:full` ejecutado en MySQL local, 64 suites / 495 tests. Segunda corrida: 63 suites y 494 tests aprobados; la única falla era la comparación del test entre DECIMAL string y number. Corregida; reejecución final de `afip.test.ts`: **24/24 aprobados**. No quedan fallas observadas. La primera corrida detectó fixtures ACF que interferían con numeración interna: limpieza limitada a los tres registros ficticios de esta tarea y teardown de futuras fixtures.
- Backend typecheck final: aprobado. Regresión aislada del protocolo: 6 verificaciones aprobadas.
- Frontend Vitest: **52/52 aprobados**. Typecheck, lint de componentes/cliente ARCA y build: aprobados. Build conserva avisos de chunk/importación dinámica preexistentes.
- Playwright con API simulada: **2/2 aprobados**, escritorio y Pixel 7. Emisión, respuesta incierta, recuperación, descarga, crédito y ausencia de desborde horizontal.
- PDFKit: muestra de 30 ítems, tres páginas, renderizada e inspeccionada; CAE presente en cada página. Artefactos locales en `tmp/pdfs` y `frontIndians/e2e/test-results`, excluidos de Git.
- Migración 108 aplicada y registrada en SequelizeMeta local; esquema de migración, modelos y ensureSchema revisados. Sin modificaciones en base productiva.
- No se hicieron llamadas autenticadas a ARCA. Configuración de producción, credenciales y homologación real siguen pendientes. Npm informó 13 vulnerabilidades del árbol completo al instalar QR; no se ejecutó un upgrade general ajeno a esta corrección.
