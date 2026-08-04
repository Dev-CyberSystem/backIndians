# Indians Textil — Sistema de Gestión Integral para la Industria Textil

## ¿Qué es Indians Textil?

**Indians Textil** es una plataforma web de gestión empresarial diseñada específicamente para talleres y empresas del rubro textil. Centraliza en un solo lugar todo lo que necesita un negocio de indumentaria para operar con eficiencia: pedidos, producción, clientes, facturación, stock y equipo de trabajo.

Deja atrás las planillas de Excel, los cuadernos de anotaciones y los WhatsApp para coordinar el taller. Con Indians Textil, cada área de tu empresa trabaja con la misma información en tiempo real.

---

## ¿A quién está dirigido?

- Talleres de confección y bordado
- Empresas de indumentaria deportiva y corporativa
- Fábricas de ropa que trabajan con pedidos a medida
- Negocios que necesitan coordinar ventas, producción y administración

---

## Problemas que resuelve

| Problema actual | Solución con Indians Textil |
|---|---|
| "¿En qué estado está el pedido del club?" | Seguimiento en tiempo real por estado, desde el ingreso hasta la entrega |
| Pedidos perdidos o mal comunicados al taller | El taller ve su propia vista con solo los pedidos que le corresponden |
| No saber cuánto se facturó en el mes | Dashboard con KPIs de facturación actualizado al momento |
| Clientes con deudas sin controlar | Alertas automáticas de facturas vencidas con días de mora |
| Stock de materiales que se acaba sin avisar | Sistema de alertas cuando el stock cae por debajo del mínimo |
| No saber qué clientes generan más negocio | Ranking de top clientes por facturación |
| Accesos sin control (todos ven todo) | Roles diferenciados: cada empleado accede solo a lo que necesita |
| Contraseñas compartidas o perdidas | El admin puede cambiar claves; recuperación por email |

---

## Módulos del sistema

### Dashboard Ejecutivo (solo Administrador)
El panel principal muestra en tiempo real:
- **KPIs del mes**: facturación, pedidos nuevos, pendientes por cobrar, facturas vencidas
- **Tendencia mensual**: gráfico de barras y líneas de los últimos 6 meses (pedidos + facturación)
- **Distribución de producción**: donut chart con todos los estados actuales del taller
- **Ranking de clientes**: top 5 clientes por volumen de facturación con barras de progreso
- **Facturas vencidas**: listado con días de mora y monto adeudado
- **Alertas de stock crítico**: materiales en 0 o por debajo del mínimo
- **Recomendaciones inteligentes**: el sistema analiza los datos y sugiere acciones concretas (ej: "La facturación cayó 23%, revisá el pipeline de ventas")

### Pedidos
Gestión completa del ciclo de vida de cada pedido:
- Creación con datos del cliente, productos, cantidades por talle y precios
- Flujo de estados: Pendiente → En revisión → Revisión taller → Observado → En producción → Control de calidad → Listo → Entregado / Cancelado
- Ficha técnica con especificaciones de confección: tipo de prenda, tipo de tela, colores, tipo de cuello, manga, sponsors, personalización (numeración, nombre)
- Carga de imágenes del pedido (logotipos, diseños, referencias)
- Generación de PDF de la ficha técnica para el taller
- Historial completo de cambios de estado

### Clientes
- Registro de clientes con datos completos: razón social, CUIT, contacto, dirección, email
- Búsqueda en tiempo real mientras se escribe
- Historial de pedidos por cliente

### Facturación
- Generación de facturas a partir de pedidos
- Estados: Borrador → Emitida → Pagada → Cancelada
- Descarga de facturas en PDF con datos del negocio, detalle de ítems y totales
- Control de facturas vencidas con alertas automáticas
- Totales de facturación mensual e histórico

### Productos
- Catálogo de productos/servicios con precios
- Base para la generación de ítems en pedidos

### Stock
- Inventario de materiales e insumos por categorías
- Registro de movimientos: entradas y salidas con descripción
- Alertas de stock bajo y stock en cero
- Histórico de todos los movimientos por ítem

### Taller
- Vista exclusiva para el personal de taller
- Muestra solo los pedidos en estados activos de producción
- Acceso a la ficha técnica completa de cada pedido
- No expone información financiera (precios, facturas, etc.)

### Gestión de Usuarios
- Creación y edición de usuarios del sistema
- 4 roles disponibles: Administrador, Facturación, Taller, Vendedor
- Activar/desactivar usuarios sin eliminarlos
- Cambio de contraseñas por parte del administrador
- Recuperación de contraseña por email

### Configuración
- Datos del negocio (nombre, CUIT, dirección, teléfono)
- Información que aparece en facturas y PDFs generados

---

## Roles y permisos

| Módulo | Administrador | Facturación | Taller | Vendedor |
|---|:---:|:---:|:---:|:---:|
| Dashboard ejecutivo | ✓ | — | — | — |
| Pedidos | ✓ | ✓ | — | ✓ |
| Clientes | ✓ | ✓ | — | ✓ |
| Productos | ✓ | ✓ | — | — |
| Facturas | ✓ | ✓ | — | ✓ |
| Stock | ✓ | ✓ | ✓ | — |
| Taller | ✓ | — | ✓ | — |
| Usuarios | ✓ | — | — | — |
| Configuración | ✓ | ✓ | — | — |

---

## Tecnología

- **Aplicación web**: accesible desde cualquier dispositivo con navegador (PC, tablet, celular)
- **Tiempo real**: los cambios de estado de los pedidos se actualizan al instante en todos los dispositivos conectados (Socket.io)
- **Seguridad**: autenticación con tokens JWT, sesiones con expiración automática, recuperación de contraseña por email
- **Almacenamiento de imágenes**: integración con Cloudinary para fotos y archivos de pedidos
- **Generación de PDFs**: fichas técnicas y facturas descargables desde el sistema
- **Base de datos MySQL**: información robusta y confiable
- **Backend Node.js + TypeScript**: arquitectura escalable y mantenible
- **Frontend React + TailwindCSS**: interfaz moderna, rápida y responsive

---

## Beneficios clave

**Organización total**
Todo el negocio en un lugar. Ventas, producción, administración y stock conectados entre sí.

**Cada uno ve lo suyo**
El personal de taller solo ve los pedidos de producción. El equipo de ventas no ve stock interno. El administrador controla todo.

**Decisiones basadas en datos**
El dashboard ejecutivo da visibilidad instantánea sobre qué está pasando en el negocio: facturación, deudas, carga de producción, materiales críticos.

**Sin papel ni Excel**
Las fichas técnicas y facturas se generan y descargan en PDF directamente desde el sistema.

**Alertas proactivas**
El sistema detecta situaciones de riesgo (stock agotado, facturas vencidas, caída en ventas) y las comunica de forma clara en el dashboard.

**Escalable con el negocio**
Se pueden agregar usuarios, productos, clientes y pedidos sin límite. El sistema crece con la empresa.

---

## Flujo operativo típico

```
1. Vendedor registra el pedido con el cliente y los productos
2. Administrador/Facturación revisa y aprueba el pedido
3. El pedido pasa al taller para producción
4. El taller lo marca como "En producción" y luego "Listo"
5. Se genera la factura desde el pedido aprobado
6. El cliente paga → la factura se marca como "Pagada"
7. Todo queda registrado en el historial del cliente
```

---

## Estados del pedido

```
Pendiente → En revisión → Revisión taller → Observado
                                                ↓
                                         En producción
                                                ↓
                                        Control de calidad
                                                ↓
                                             Listo
                                                ↓
                                           Entregado
```

---

*Indians Textil — Desarrollado a medida para la industria textil argentina*
