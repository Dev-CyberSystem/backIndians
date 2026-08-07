import { api, API, loginAs, auth } from './helpers';
import { businessDate } from '../../utils/helpers';

/*
 * Verificación final previa a producción (2026-08-07). Cubre los defectos
 * comprobados por sondeo adversarial que la auditoría de verificación anterior
 * no había detectado o había dejado abiertos:
 *
 *  - CASH-MA-001 (CRÍTICO, nuevo): `updateAccount`/`updateCategory` hacían
 *    `instance.update(req.body)` con el body crudo. `express-validator` valida
 *    los campos declarados pero no descarta los demás, así que un
 *    `PUT /cash/accounts/:id {"current_balance": 999999}` reescribía el saldo
 *    directamente, sin asiento y sin pasar por el libro contable — el mismo
 *    resultado que la Fase 2 había cerrado por el lado de las transacciones.
 *  - CASH-MUT-003 (P1, abierto): `patchTransaction` no miraba el `status`, así
 *    que un movimiento ya revertido —y hasta el propio contraasiento— seguía
 *    aceptando cambios de categoría, reescribiendo los reportes.
 *  - CASH-VAL-005 (P1, abierto): la categoría no se validaba en absoluto.
 *  - CASH-VAL-006 (P2, abierto): una FK inexistente devolvía 500.
 *  - TZ: la fecha de los asientos automáticos salía de `toISOString()` (UTC),
 *    no de la jornada del negocio (UTC−3).
 */

const TODAY = businessDate();

describe('Endurecimiento de integridad de caja — verificación final', () => {
  let admin: string;
  let billing: string;
  let accountId: number;
  let catBoth: number;
  let catIncome: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    billing = await loginAs('billing');

    const a = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Hardening QA ${Date.now()}`, type: 'cash' });
    accountId = a.body.data.id;

    const b = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Hardening Both QA ${Date.now()}`, type: 'both' });
    catBoth = b.body.data.id;

    const c = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Hardening Income QA ${Date.now()}`, type: 'income' });
    catIncome = c.body.data.id;
  });

  async function accountRow(id: number) {
    const res = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    return (res.body.data as Array<{ id: number; current_balance: number; active: boolean }>)
      .find((x) => x.id === id)!;
  }

  // ── CASH-MA-001 ─────────────────────────────────────────────────────────

  it('PUT /cash/accounts/:id no puede reescribir el saldo (mass assignment)', async () => {
    const before = await accountRow(accountId);

    const res = await api().put(`${API}/cash/accounts/${accountId}`).set(...auth(admin))
      .send({ name: 'Cuenta Hardening QA renombrada', current_balance: 999999.99 });
    expect(res.status).toBe(200);

    const after = await accountRow(accountId);
    // El campo legítimo sí se aplica; el saldo, nunca.
    expect(after.current_balance).toBe(before.current_balance);
    expect(res.body.data.name).toBe('Cuenta Hardening QA renombrada');
  });

  it('PUT /cash/accounts/:id no puede dar de baja la cuenta esquivando /toggle', async () => {
    const res = await api().put(`${API}/cash/accounts/${accountId}`).set(...auth(admin))
      .send({ active: false });
    expect(res.status).toBe(200);
    expect((await accountRow(accountId)).active).toBe(true);
  });

  it('billing tampoco puede reescribir el saldo por mass assignment', async () => {
    const before = await accountRow(accountId);
    await api().put(`${API}/cash/accounts/${accountId}`).set(...auth(billing))
      .send({ current_balance: 1 });
    expect((await accountRow(accountId)).current_balance).toBe(before.current_balance);
  });

  it('PUT /cash/categories/:id no puede convertir una categoría en categoría del sistema', async () => {
    const res = await api().put(`${API}/cash/categories/${catBoth}`).set(...auth(admin))
      .send({ is_system: true, active: false });
    expect(res.status).toBe(200);

    const list = await api().get(`${API}/cash/categories`).set(...auth(admin));
    const row = (list.body.data as Array<{ id: number; is_system: boolean; active: boolean }>)
      .find((c) => c.id === catBoth);

    // Si `is_system` se hubiera colado, la categoría quedaría inmodificable e
    // indesactivable para siempre; si `active` se hubiera colado, no estaría
    // en este listado (que solo devuelve activas).
    expect(row).toBeDefined();
    expect(row!.is_system).toBe(false);
    expect(row!.active).toBe(true);
  });

  // ── CASH-VAL-005 ────────────────────────────────────────────────────────

  it('no se acepta una categoría de tipo incompatible con el movimiento', async () => {
    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catIncome, type: 'expense',
      amount: 500, description: 'Egreso con categoria de ingreso', date: TODAY,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo/i);
  });

  it('una categoría de tipo "both" sirve para ingreso y para egreso', async () => {
    const inc = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'income',
      amount: 100, description: 'Ingreso con categoria both', date: TODAY,
    });
    const exp = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'expense',
      amount: 100, description: 'Egreso con categoria both', date: TODAY,
    });
    expect(inc.status).toBe(201);
    expect(exp.status).toBe(201);
  });

  it('no se acepta una categoría desactivada', async () => {
    const tmp = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Baja QA ${Date.now()}`, type: 'both' });
    const tmpId = tmp.body.data.id;
    await api().patch(`${API}/cash/categories/${tmpId}/toggle`).set(...auth(admin));

    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: tmpId, type: 'income',
      amount: 500, description: 'Alta con categoria de baja', date: TODAY,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/desactivada/i);
  });

  it('un rechazo por categoría no deja el saldo tocado a medias', async () => {
    const before = await accountRow(accountId);
    await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catIncome, type: 'expense',
      amount: 4321, description: 'Rechazado por tipo de categoria', date: TODAY,
    });
    expect((await accountRow(accountId)).current_balance).toBe(before.current_balance);
  });

  // ── CASH-VAL-006 ────────────────────────────────────────────────────────

  it('una categoría inexistente devuelve 404, no 500', async () => {
    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: 99999999, type: 'income',
      amount: 500, description: 'Categoria inexistente', date: TODAY,
    });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });

  // ── CASH-MUT-003 ────────────────────────────────────────────────────────

  it('un movimiento revertido no se puede modificar', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'income',
      amount: 7000, description: 'Se revierte y luego se intenta editar', date: TODAY,
    });
    const txId = tx.body.data.id;

    const rev = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion total para probar el PATCH' });
    expect(rev.status).toBe(201);

    const patch = await api().patch(`${API}/cash/transactions/${txId}`).set(...auth(admin))
      .send({ category_id: catIncome, description: 'Reescrito despues de revertir' });
    expect(patch.status).toBe(400);

    // El movimiento quedó intacto: sin esto, el original y su contraasiento
    // dejaban de cancelarse en `by_category`.
    const check = await api().get(`${API}/cash/transactions/${txId}`).set(...auth(admin));
    expect(check.body.data.category_id).toBe(catBoth);
    expect(check.body.data.description).toBe('Se revierte y luego se intenta editar');
  });

  it('un contraasiento de reversión no se puede modificar', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'income',
      amount: 800, description: 'Original de un contraasiento', date: TODAY,
    });
    const rev = await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion cuyo contraasiento no se toca' });

    const patch = await api().patch(`${API}/cash/transactions/${rev.body.data.id}`).set(...auth(admin))
      .send({ description: 'Reescrito el contraasiento' });
    expect(patch.status).toBe(400);
  });

  it('un movimiento parcialmente revertido SÍ se puede seguir editando', async () => {
    // Guarda de regresión: la restricción es sobre movimientos cerrados, no
    // sobre los que siguen vigentes con una reversión parcial encima.
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'income',
      amount: 1000, description: 'Reversion parcial', date: TODAY,
    });
    const txId = tx.body.data.id;

    await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion parcial de 400', amount: 400 });

    const patch = await api().patch(`${API}/cash/transactions/${txId}`).set(...auth(admin))
      .send({ notes: 'Nota agregada con reversion parcial encima' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('active');
  });

  it('un PATCH no puede mover el movimiento a una categoría inválida', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'expense',
      amount: 250, description: 'Se intenta recategorizar mal', date: TODAY,
    });
    const patch = await api().patch(`${API}/cash/transactions/${tx.body.data.id}`).set(...auth(admin))
      .send({ category_id: catIncome });
    expect(patch.status).toBe(400);

    const inexistente = await api().patch(`${API}/cash/transactions/${tx.body.data.id}`).set(...auth(admin))
      .send({ category_id: 99999999 });
    expect(inexistente.status).toBe(404);
  });

  // ── Fecha de negocio ────────────────────────────────────────────────────

  it('el contraasiento se fecha en la jornada del negocio, no en UTC', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: catBoth, type: 'income',
      amount: 600, description: 'Para verificar la fecha del contraasiento', date: TODAY,
    });
    const rev = await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Verificacion de zona horaria del contraasiento' });

    expect(rev.body.data.date).toBe(businessDate());
  });
});
