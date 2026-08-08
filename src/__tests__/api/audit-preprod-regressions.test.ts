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
 */
import jwt from 'jsonwebtoken';
import { api, API, loginAdmin } from './helpers';
import { StoreCustomer, StoreAddress, StockItem, StockMovement } from '../../models';

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

    await api()
      .post(`${API}/store/me/addresses`)
      .set('Authorization', `Bearer ${storeToken(attacker.id, attacker.email)}`)
      .send({
        id: addrId, street: 'Guarida del atacante 666', city: 'Tucuman',
        customer_id: victim.id, is_default: true,
      });

    const after = await StoreAddress.findByPk(addrId);
    expect(after?.customer_id).toBe(attacker.id);

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
});
