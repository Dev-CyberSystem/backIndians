/**
 * Tests de regresión de la auditoría integral de preproducción (2026-08-08).
 *
 * Cada bloque reproduce un hallazgo REAL que fue demostrado fallando antes de
 * la corrección. No borrar: son la red que evita que estos tres agujeros
 * vuelvan a abrirse.
 *
 *  - AUD-01 (P1) mass assignment en `POST /store/me/addresses`: escritura
 *    cruzada de una dirección a la cuenta de otro comprador.
 *  - AUD-02 (P1) mass assignment en `PUT /stock/:id`: reescritura del stock de
 *    un material sin asiento en `stock_movements`.
 *  - AUD-03 (P1) cambiar/resetear la contraseña de un usuario del sistema no
 *    revocaba sus sesiones (el refresh token de 7 días seguía sirviendo).
 *  - AUD-15 (P1) `saveProductSizes` borraba y recreaba los talles, perdiendo
 *    `stock_reserved` y dejando pedidos pagados imposibles de confirmar.
 */
import jwt from 'jsonwebtoken';
import { api, API, loginAdmin, loginAs, auth } from './helpers';
import { StoreCustomer, StoreAddress, StockItem, StockMovement, User, PasswordResetToken } from '../../models';
import { CatalogProductSize } from '../../models/CatalogProductSize';

const storeToken = (id: number, email: string) =>
  jwt.sign(
    { sub: id, email, type: 'store_customer', session_version: 1 },
    process.env.STORE_JWT_SECRET || process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );

describe('AUD-01 — direcciones de la tienda: sin escritura cruzada entre compradores', () => {
  it('inyectar customer_id ajeno NO mueve la dirección a la cuenta de la víctima', async () => {
    const attacker = await StoreCustomer.create({
      name: 'Atacante', email: `aud01-atk+${Date.now()}@test.local`,
      password_hash: 'x', email_verified: true,
    });
    const victim = await StoreCustomer.create({
      name: 'Victima', email: `aud01-vic+${Date.now()}@test.local`,
      password_hash: 'x', email_verified: true,
    });

    const created = await api()
      .post(`${API}/store/me/addresses`)
      .set('Authorization', `Bearer ${storeToken(attacker.id, attacker.email)}`)
      .send({ label: 'Casa', street: 'Calle Falsa 123', city: 'Tucuman' });
    expect(created.status).toBe(200);
    const addrId = created.body.data.id;

    const attack = await api()
      .post(`${API}/store/me/addresses`)
      .set('Authorization', `Bearer ${storeToken(attacker.id, attacker.email)}`)
      .send({
        id: addrId, street: 'Guarida del atacante 666', city: 'Tucuman',
        customer_id: victim.id, is_default: true,
      });
    // El status se verifica a propósito (REV-05): sin esto, el test también
    // pasaría si el endpoint empezara a tirar 500 — la dirección no se movería
    // porque no se ejecutaría nada, y el "verde" no significaría nada.
    expect(attack.status).toBe(200);

    const after = await StoreAddress.findByPk(addrId);
    expect(after?.customer_id).toBe(attacker.id);
    // Los campos legítimos del mismo request SÍ se aplicaron: el whitelist
    // filtra `customer_id`, no descarta la edición entera.
    expect(after?.street).toBe('Guarida del atacante 666');

    // Y la víctima no tiene ninguna dirección ajena en su libreta.
    const victimAddresses = await StoreAddress.count({ where: { customer_id: victim.id } });
    expect(victimAddresses).toBe(0);
  });
});

describe('AUD-02 — stock de materiales: sólo se mueve por asientos', () => {
  it('PUT /stock/:id NO puede reescribir current_quantity', async () => {
    const token = await loginAdmin();

    const item = await StockItem.create({
      name: `AUD02 material ${Date.now()}`, unit: 'unidad',
      current_quantity: 10, min_quantity: 0, active: true,
    });

    const res = await api()
      .put(`${API}/stock/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: item.name, current_quantity: 999999 });
    expect(res.status).toBe(200);

    await item.reload();
    expect(Number(item.current_quantity)).toBe(10);
    expect(await StockMovement.count({ where: { stock_item_id: item.id } })).toBe(0);
  });

  it('tampoco puede billing, que también llega a la ruta', async () => {
    // REV-05: `authorize('admin','billing')` en stock.routes.ts — el hallazgo
    // era alcanzable por los dos roles y sólo se probaba uno.
    const token = await loginAs('billing');
    const item = await StockItem.create({
      name: `AUD02 billing ${Date.now()}`, unit: 'unidad',
      current_quantity: 42, min_quantity: 0, active: true,
    });

    const res = await api()
      .put(`${API}/stock/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: item.name, current_quantity: 1 });
    expect(res.status).toBe(200);

    await item.reload();
    expect(Number(item.current_quantity)).toBe(42);
    expect(await StockMovement.count({ where: { stock_item_id: item.id } })).toBe(0);
  });

  it('los campos legítimos sí se siguen pudiendo editar', async () => {
    const token = await loginAdmin();
    const item = await StockItem.create({
      name: `AUD02 editable ${Date.now()}`, unit: 'unidad',
      current_quantity: 5, min_quantity: 0, active: true,
    });

    const res = await api()
      .put(`${API}/stock/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nombre corregido', min_quantity: 7, description: 'Nota' });
    expect(res.status).toBe(200);

    await item.reload();
    expect(item.name).toBe('Nombre corregido');
    expect(Number(item.min_quantity)).toBe(7);
    expect(Number(item.current_quantity)).toBe(5);
  });
});

describe('AUD-03 — cambiar la contraseña revoca las sesiones abiertas', () => {
  it('el refresh token emitido antes del cambio deja de servir', async () => {
    const admin = await loginAdmin();

    const email = `aud03+${Date.now()}@test.local`;
    const create = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'AUD Reset', email, password: 'Abc123!', role: 'seller' });
    expect([200, 201]).toContain(create.status);
    const userId = create.body.data.id;

    const login = await api().post(`${API}/auth/login`).send({ email, password: 'Abc123!' });
    expect(login.status).toBe(200);
    const oldRefresh = login.body.data.refreshToken ?? login.body.data.refresh_token;
    const oldAccess = login.body.data.accessToken ?? login.body.data.token;
    expect(oldRefresh).toBeTruthy();

    const chg = await api()
      .patch(`${API}/users/${userId}/password`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ password: 'Xyz789!' });
    expect([200, 204]).toContain(chg.status);

    // Ni el refresh token (7 días) ni el access token (15 min) previos sirven.
    const refreshed = await api().post(`${API}/auth/refresh`).send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(401);

    const me = await api().get(`${API}/auth/me`).set('Authorization', `Bearer ${oldAccess}`);
    expect(me.status).toBe(401);

    // La contraseña nueva sí permite entrar de nuevo.
    const relogin = await api().post(`${API}/auth/login`).send({ email, password: 'Xyz789!' });
    expect(relogin.status).toBe(200);
  });

  /*
   * REV-04: el fix tocó TRES caminos y sólo se probaba uno. Los dos de abajo
   * cubren los que faltaban. El de `resetPasswordService` es el más importante
   * de los tres — quien pide un reset suele hacerlo porque sospecha que le
   * tomaron la cuenta.
   */
  it('PUT /users/:id con password nueva también revoca las sesiones', async () => {
    const admin = await loginAdmin();
    const email = `aud03-put+${Date.now()}@test.local`;
    const create = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'AUD PUT', email, password: 'Abc123!', role: 'seller' });
    expect([200, 201]).toContain(create.status);
    const userId = create.body.data.id;

    const login = await api().post(`${API}/auth/login`).send({ email, password: 'Abc123!' });
    expect(login.status).toBe(200);
    const oldRefresh = login.body.data.refreshToken ?? login.body.data.refresh_token;

    const upd = await api()
      .put(`${API}/users/${userId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'AUD PUT', password: 'Xyz789!' });
    expect(upd.status).toBe(200);

    const refreshed = await api().post(`${API}/auth/refresh`).send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(401);

    const relogin = await api().post(`${API}/auth/login`).send({ email, password: 'Xyz789!' });
    expect(relogin.status).toBe(200);
  });

  it('el reset por token (olvidé mi contraseña) también revoca las sesiones', async () => {
    const admin = await loginAdmin();
    const email = `aud03-reset+${Date.now()}@test.local`;
    const create = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'AUD Reset Token', email, password: 'Abc123!', role: 'seller' });
    expect([200, 201]).toContain(create.status);
    const userId = create.body.data.id;

    const login = await api().post(`${API}/auth/login`).send({ email, password: 'Abc123!' });
    expect(login.status).toBe(200);
    const oldRefresh = login.body.data.refreshToken ?? login.body.data.refresh_token;

    // Se crea el token directo: el camino por mail no es determinístico en test.
    const token = `aud03-reset-token-${Date.now()}`;
    await PasswordResetToken.create({
      user_id: userId,
      token,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      used: false,
    });

    const reset = await api()
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: 'Xyz789!' });
    expect(reset.status).toBe(200);

    const refreshed = await api().post(`${API}/auth/refresh`).send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(401);

    const relogin = await api().post(`${API}/auth/login`).send({ email, password: 'Xyz789!' });
    expect(relogin.status).toBe(200);
  });

  it('el incremento de session_version es atómico, no read-modify-write', async () => {
    // REV-01: `session_version = <leído antes del bcrypt> + 1` perdía el
    // incremento de un login concurrente. Con `increment()` (SQL `+ 1`), dos
    // cambios de contraseña simultáneos avanzan la versión DOS veces.
    const admin = await loginAdmin();
    const email = `aud03-race+${Date.now()}@test.local`;
    const create = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'AUD Race', email, password: 'Abc123!', role: 'seller' });
    expect([200, 201]).toContain(create.status);
    const userId = create.body.data.id;

    const before = (await User.findByPk(userId))!.session_version as number;

    await Promise.all([
      api().patch(`${API}/users/${userId}/password`)
        .set('Authorization', `Bearer ${admin}`).send({ password: 'Xyz789!' }),
      api().patch(`${API}/users/${userId}/password`)
        .set('Authorization', `Bearer ${admin}`).send({ password: 'Qwe456!' }),
    ]);

    const after = (await User.findByPk(userId))!.session_version as number;
    // Con read-modify-write ambas escribían `before + 1` y esto daba 1.
    expect(after - before).toBe(2);
  });
});

describe('AUD-15 — editar los talles de un producto no pierde las reservas vivas', () => {
  let admin: string;
  let productId: number;
  let sizeMId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `AUD15 Talles QA ${Date.now()}`,
      price: 4000,
      show_in_store: true,
      active: true,
      sizes: [
        { size_name: 'M', stock_quantity: 10 },
        { size_name: 'L', stock_quantity: 5 },
      ],
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;

    // Un pedido sin pagar deja 3 unidades RESERVADAS en el talle M.
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot AUD15',
      customerEmail: `aud15+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: 'M', quantity: 3 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
    });
    expect(checkout.status).toBe(201);

    const sizeM = await CatalogProductSize.findOne({ where: { product_id: productId, size_name: 'M' } });
    sizeMId = sizeM!.id;
    expect(Number(sizeM!.stock_reserved)).toBe(3);
  });

  it('conservar un talle preserva su id y su stock_reserved (antes volvían a 0)', async () => {
    const res = await api()
      .put(`${API}/catalog/products/${productId}/sizes`)
      .set(...auth(admin))
      .send({ sizes: [{ size_name: 'M', stock_quantity: 20 }, { size_name: 'L', stock_quantity: 5 }] });
    expect(res.status).toBe(200);

    const sizeM = await CatalogProductSize.findOne({ where: { product_id: productId, size_name: 'M' } });
    // Misma fila, no una recreada: las FKs que la apuntan siguen válidas.
    expect(sizeM!.id).toBe(sizeMId);
    expect(Number(sizeM!.stock_quantity)).toBe(20);
    // Lo que rompía AUD-15: la reserva sobrevive a la edición.
    expect(Number(sizeM!.stock_reserved)).toBe(3);
  });

  it('quitar un talle CON reservas vivas se rechaza con 409 y no borra nada', async () => {
    const res = await api()
      .put(`${API}/catalog/products/${productId}/sizes`)
      .set(...auth(admin))
      .send({ sizes: [{ size_name: 'L', stock_quantity: 5 }] });
    expect(res.status).toBe(409);

    const sizeM = await CatalogProductSize.findOne({ where: { product_id: productId, size_name: 'M' } });
    expect(sizeM).not.toBeNull();
    expect(sizeM!.id).toBe(sizeMId);
    expect(Number(sizeM!.stock_reserved)).toBe(3);
  });

  it('quitar un talle SIN reservas sigue funcionando (no corregir de más)', async () => {
    const res = await api()
      .put(`${API}/catalog/products/${productId}/sizes`)
      .set(...auth(admin))
      .send({ sizes: [{ size_name: 'M', stock_quantity: 20 }, { size_name: 'XL', stock_quantity: 7 }] });
    expect(res.status).toBe(200);

    const names = (await CatalogProductSize.findAll({ where: { product_id: productId } }))
      .map((s) => s.size_name)
      .sort();
    expect(names).toEqual(['M', 'XL']);
  });

  it('dos talles con el mismo nombre se rechazan con 400', async () => {
    const res = await api()
      .put(`${API}/catalog/products/${productId}/sizes`)
      .set(...auth(admin))
      .send({ sizes: [{ size_name: 'M', stock_quantity: 1 }, { size_name: 'M', stock_quantity: 2 }] });
    expect(res.status).toBe(400);
  });
});
