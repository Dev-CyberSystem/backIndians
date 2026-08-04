# Mail de bienvenida al crear un usuario — Indians Textil

## Objetivo

Cada vez que un administrador crea un usuario del **sistema interno** (no de la
tienda online), se envía automáticamente un email de bienvenida a la dirección
del nuevo usuario informándole sus datos de acceso. Replica el patrón que ya usa
la tienda online para sus correos transaccionales (Resend + dominio verificado).

## Qué se envía

- **Para:** el email del usuario recién creado.
- **Asunto:** `Tu cuenta en el sistema Indians`.
- **Contenido:**
  - Nombre del usuario.
  - Email (usuario de acceso).
  - **Contraseña inicial en texto plano** (la que definió el administrador al
    crearlo), acompañada de la recomendación de cambiarla luego del primer
    ingreso.
  - Rol con su etiqueta amigable (Administrador / Facturación / Taller / Vendedor).
  - Botón + link directo a `${SYSTEM_URL}/login`.

> **Nota de seguridad:** se decidió incluir la contraseña en el correo para que
> el usuario nuevo pueda ingresar sin fricción, junto con la recomendación de
> cambiarla. Todos los datos del usuario se escapan con `escapeHtml` antes de
> insertarse en el HTML (anti-inyección).

## Diseño visual (jul 2026)

Se rediseñaron el mail de bienvenida y el de recuperación de contraseña del
**sistema interno** (`backIndians/src/utils/mailer.ts`) con identidad de marca:

- **Logo de Indians** alojado en Cloudinary (`indians/branding/logo-mail`,
  subido desde el arte oficial en PNG transparente). Se referencia con
  transformaciones on-the-fly (`f_auto,q_auto,w_200`) para servirlo optimizado
  (~1.6 KB) sin necesidad de generar variantes manualmente.
- **Tagline de marca** debajo del logo: *"Ropa deportiva y casual · Tienda
  online"* — conecta el mail de un usuario interno con la identidad de la
  tienda online, tal como se pidió.
- **Tarjeta blanca centrada** (`max-width:480px`, bordes redondeados) sobre
  fondo gris claro, con footer (`Indians Textil · indians.com.ar`).
- Implementado como un helper compartido `emailWrapper(bodyHtml)` en
  `mailer.ts`, usado tanto por `buildWelcomeEmail` como por
  `buildPasswordResetEmail` — mismo look & feel en los dos mails del sistema.

> Los mails de la **tienda** (`email.service.ts`: verificación, confirmación de
> pedido, pago aprobado/rechazado, factura, reset de contraseña de compradores)
> no se tocaron en este cambio — tienen su propio estilo. Se puede aplicar el
> mismo `emailWrapper` ahí si se quiere unificar la identidad visual en toda la
> plataforma.

## Implementación

### Backend

- **`backIndians/src/utils/mailer.ts`**
  - Nueva función `buildWelcomeEmail({ name, email, role, password, loginUrl })`
    que arma el HTML del correo con el estilo de marca (mismo que los demás
    mails del sistema/tienda).
  - Mapa `ROLE_LABELS` con las etiquetas amigables de rol (idénticas a las de la
    UI de administración, `frontIndians/src/pages/admin/UsersPage.tsx`).
  - Reutiliza `sendMail(...)` (Resend, `RESEND_API_KEY` / `RESEND_FROM_EMAIL`).

- **`backIndians/src/services/user.service.ts`**
  - `deliverWelcomeEmail(user, password)`: helper interno que envía el mail y
    **persiste el resultado** en el usuario (`welcome_email_sent_at` /
    `welcome_email_error`). Nunca lanza: devuelve `{ sent, error? }`. En éxito
    loguea `user.welcomeEmail.sent`; en fallo guarda el motivo (acotado a 500
    chars) y loguea `logger.error('user.welcomeEmail', ...)`.
  - `createUser(...)`: tras `User.create(...)` **espera** el envío
    (`await deliverWelcomeEmail`) para poder **confirmarlo en la respuesta**,
    pero un fallo **no** revierte la creación. Devuelve
    `{ user, welcomeEmail }` (el usuario sin `password_hash`).
  - `resendWelcomeEmail(id)`: **reenvío** ante un fallo. Como la contraseña
    original está hasheada y no es recuperable, **genera una contraseña temporal
    nueva** (`generateTempPassword`, válida para el regex de la ruta: 6-10 chars
    con letra + dígito + especial, vía `crypto.randomInt`), actualiza la cuenta y
    la envía en el mail. Si el reenvío también falla, lanza `AppError` 502 con el
    motivo.
  - La URL del sistema se resuelve con `SYSTEM_URL` → `FRONTEND_URL` (primer
    origen del CSV) → `http://localhost:5173` como fallback.

- **`backIndians/src/controllers/user.controller.ts`**
  - `createUser` responde `201` con `data: { ...usuario, welcomeEmail }`.
  - `resendWelcome` (nuevo) responde `200` con `data: { ...usuario, welcomeEmail }`.

- **Rutas** (`user.routes.ts`, todas bajo `authenticate + authorize('admin')`):
  - `POST /users/:id/resend-welcome` → reenvío del mail.

- **Persistencia** (migración `20260701-050-users-welcome-email-status.js`):
  columnas `welcome_email_sent_at DATETIME NULL` y `welcome_email_error
  VARCHAR(500) NULL` en `users` (+ mismos campos en el modelo `User`).

### Frontend

- **`frontIndians/src/pages/admin/UsersPage.tsx`**
  - **Filtros**: buscador por nombre/email + `Select` por rol (client-side, la
    lista de usuarios es acotada y no paginada). Estado vacío "Sin resultados"
    cuando ningún usuario coincide.
  - **Columna "Mail"**: badge `Enviado` (verde) si `welcome_email_sent_at`;
    `Falló` (rojo, con el motivo en `title`) si `welcome_email_error`; `—` si no
    hay dato (usuarios previos a la feature).
  - **Botón "Reenviar"** (ícono `Send`): visible solo cuando el mail falló.
    Pide confirmación (avisa que se genera una contraseña temporal nueva) y llama
    a `usersApi.resendWelcome`.
  - **Toast de creación**: éxito ("Mail de bienvenida enviado a …") o warning con
    el motivo del fallo e indicación de reenviar desde la lista.
  - **Botón "Generar" contraseña** (ícono `Wand2`, solo en el alta): completa el
    campo con una contraseña válida por construcción (`generatePassword`) y la
    muestra (toggle ojo) para que el admin pueda verla/copiarla. El campo además
    valida el formato si se escribe a mano (`superRefine` con `PWD_REGEX`).
- **`frontIndians/src/utils/validations.ts`**: `generatePassword()` — 10 chars con
  al menos una letra, un dígito y un carácter especial (usa `crypto.getRandomValues`,
  evita caracteres ambiguos). Cumple `PWD_REGEX` por construcción. Es el equivalente
  de front del `generateTempPassword` del backend (usado en el reenvío).
- **`frontIndians/src/api/users.ts`**: `create` devuelve `User & { welcomeEmail }`;
  nuevo `resendWelcome(id)`.
- **`frontIndians/src/types/index.ts`**: `User` suma `welcome_email_sent_at` /
  `welcome_email_error`; nuevo tipo `WelcomeEmailStatus`.

## Variables de entorno relevantes

| Variable            | Uso                                                          |
| ------------------- | ----------------------------------------------------------- |
| `RESEND_API_KEY`    | API key de Resend para el envío.                            |
| `RESEND_FROM_EMAIL` | Remitente (default `noreply@indians.com.ar`).              |
| `SYSTEM_URL`        | Base para el link de login (subdominio `sistema.`).         |
| `FRONTEND_URL`      | Fallback de `SYSTEM_URL` (puede ser un CSV de orígenes CORS).|

## Tests

Archivo: **`backIndians/src/__tests__/api/users-welcome-email.test.ts`**

Se mockea únicamente `sendMail` (el envío real por Resend) con
`jest.requireActual`, dejando intacta `buildWelcomeEmail` para poder inspeccionar
el HTML real.

- **Unitarios de la plantilla** (`buildWelcomeEmail`, sin dependencias de DB):
  - Incluye nombre, email y contraseña.
  - Traduce el rol a su etiqueta amigable.
  - Incluye el link de ingreso y la recomendación de cambiar la contraseña.
  - Escapa HTML en los datos del usuario (anti-inyección).
- **Integración** (`POST /api/v1/users`, requiere MySQL migrado + `npm run seed:admin`):
  - Al crear un usuario responde `201`, llama a `sendMail` una vez con el `to`,
    asunto y HTML correctos, y **confirma** el envío (`welcomeEmail.sent === true`,
    `welcome_email_sent_at` persistido).
  - Un fallo en el envío **no** rompe la creación (sigue `201`) y **persiste el
    motivo** (`welcomeEmail.sent === false`, `welcome_email_error`).
  - `POST /users/:id/resend-welcome` reenvía con una **contraseña temporal nueva**
    (el HTML ya no contiene la contraseña original) y responde `200`.
  - Reenvío a un usuario inexistente → `404`.
- **Eliminación** (`DELETE /api/v1/users/:id`, ver sección siguiente):
  - Usuario sin relaciones → `200` y desaparece del listado.
  - Usuario con actividad (ej. un cambio de estado) → `409` con el detalle.
  - Auto-eliminación → `400`; inexistente → `404`.

**Frontend — `generatePassword`** (`frontIndians/src/__tests__/validations.test.ts`,
Vitest): 500 iteraciones cumplen `PWD_REGEX`; 10 chars con letra + dígito +
especial; sin colisiones en 50 generaciones.

**E2E** (`e2e/tests/users.spec.ts`, Playwright/Chromium): el alta usa el **botón
"Generar"** y valida el formato del valor generado, luego verifica el estado del
mail, los filtros y el borrado definitivo.

Correr:

```bash
cd backIndians && npx jest users-welcome-email             # API (necesita DB+seed)
cd frontIndians && npx vitest run src/__tests__/validations # unitario del generador
cd e2e && npx playwright test users.spec.ts --project=chromium  # E2E navegador
```

---

# Eliminación definitiva de usuarios

## Objetivo

Poder **eliminar usuarios del sistema de forma permanente** (borrado físico en la
base, sin vuelta atrás). Como son perfiles operacionales, la eliminación se
**bloquea** si el usuario tiene relaciones/actividad; si las verificaciones pasan,
se borra directamente de la base.

## Regla de negocio

`DELETE /users/:id` (`user.service.ts::deleteUser(id, requesterId)`) — solo admin.
No hace soft delete: **borra la fila** (`user.destroy()`). Antes valida:

1. **No eliminarse a sí mismo** → `400`.
2. **No eliminar el único administrador** (deja el sistema sin admins) → `400`.
3. **Sin relaciones operacionales** — cuenta en paralelo y **bloquea con `409`** si
   hay alguna, indicando cuántas de cada tipo:
   - **Pedidos** — `orders.created_by` o `orders.seller_id`.
   - **Facturas** — `invoices` cuyo pedido pertenece al usuario (join a `orders`).
   - **Ventas de catálogo** — `catalog_orders.seller_id`.
   - **Movimientos de stock** — `stock_movements.user_id`.
   - **Transacciones de caja** — `cash_transactions.created_by`.
   - **Cambios de estado de pedidos** — `order_status_history.changed_by`.

   > Nota: la mayoría de esas FK son `RESTRICT`, así que **cualquier** relación
   > (incluso de pedidos cancelados) impide el borrado por integridad referencial;
   > por eso el mensaje sugiere **desactivar** el usuario en lugar de eliminarlo.

4. **Tokens de reset de contraseña se limpian explícitamente** antes del
   `destroy()` (`PasswordResetToken.destroy({ where: { user_id: id } })`). Son
   metadata descartable, no actividad de negocio, así que nunca deberían
   bloquear el borrado.
   > **Bug encontrado y corregido (jul 2026):** la migración declara esa FK con
   > `onDelete: 'CASCADE'`, pero en un entorno de desarrollo donde corrió
   > `sequelize.sync({ alter: true })` la restricción real en MySQL quedó como
   > `NO ACTION` (Sequelize no reaplica de forma confiable las reglas de
   > referencia al alterar tablas). Un usuario que alguna vez usó "olvidé mi
   > contraseña" quedaba **atascado**: no podía eliminarse pese a no tener
   > ninguna actividad de negocio. Se detectó al probar el rediseño de mails
   > (el mail de forgot generaba el token). Fix: no depender de la regla de la
   > FK en la base — limpiar los tokens explícitamente en código.
5. Red de seguridad: el `destroy()` va en `try/catch`; un
   `SequelizeForeignKeyConstraintError` no contemplado (ej. imágenes de pedidos
   subidas por el usuario, `order_images.uploaded_by`) se traduce a un `409`
   claro.

Mensaje de ejemplo: *"No se puede eliminar: el usuario tiene 9 pedido(s),
6 factura(s) asociado(s). Los perfiles con actividad registrada no pueden
eliminarse; desactivalo en su lugar."*

## Frontend (`UsersPage.tsx`)

- Botón **eliminar** (ícono `Trash2`) en la fila. Abre el `confirm` con
  `variant: 'danger'` (que ya muestra "⚠ Esta acción no se puede deshacer") y
  texto explícito de borrado permanente.
- `deleteMutation` (`usersApi.remove`): en éxito invalida `['users']` y avisa; en
  error muestra el `message` del `409`/`400` (detalle de las relaciones) por 8 s.

## Tests (mismo archivo `users-welcome-email.test.ts`)

- Elimina un usuario sin relaciones → `200` y desaparece del listado.
- Elimina un usuario que tiene un token de reset de contraseña (regresión del
  bug de arriba) → `200`.
- Bloquea (`409`) al crear una relación (`OrderStatusHistory.changed_by`) y luego,
  al quitarla, permite el borrado (`200`).
- Auto-eliminación → `400`; inexistente → `404`.

**13/13 pasan** (antes 12; se sumó el test de regresión del token de reset).
