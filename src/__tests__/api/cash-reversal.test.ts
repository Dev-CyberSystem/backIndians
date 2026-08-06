import { api, API, loginAs, auth } from './helpers';
import { CashTransaction } from '../../models/CashTransaction';

/*
 * Inmutabilidad y reversión de movimientos de caja (Fase 2 del plan de
 * corrección — cierra el hallazgo CASH-MUT-001: hoy un movimiento confirmado
 * se puede editar/borrar sin motivo ni rastro del valor anterior).
 *
 * Cubre: reversión total, parcial, sobre-reversión, doble reversión,
 * reversión de una reversión, PATCH limitado a campos no financieros,
 * PUT/DELETE eliminados de la API, idempotencia secuencial y concurrente.
 */

const TODAY = new Date().toISOString().slice(0, 10);

describe('Reversión e inmutabilidad de caja — Fase 2', () => {
  let admin: string;
  let accountId: number;
  let accountBId: number;
  let categoryId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');

    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja Reversión QA ${Date.now()}`, type: 'cash' });
    accountId = acc.body.data.id;

    const accB = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja Destino QA ${Date.now()}`, type: 'bank' });
    accountBId = accB.body.data.id;

    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Reversión QA ${Date.now()}`, type: 'both' });
    categoryId = cat.body.data.id;
  });

  async function createTx(amount: number, type: 'income' | 'expense' = 'income') {
    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: categoryId, type, amount,
      description: `Movimiento QA ${amount}`, date: TODAY,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  async function accountBalance(id: number): Promise<number> {
    const res = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    const acc = (res.body.data as Array<{ id: number; current_balance: string }>).find((a) => a.id === id);
    return Number(acc!.current_balance);
  }

  // ── Reversión total ────────────────────────────────────────────────────────

  it('revertir por el total: crea contraasiento, deja el original marcado, el saldo neto vuelve a cero', async () => {
    const before = await accountBalance(accountId);
    const txId = await createTx(5000);
    expect(await accountBalance(accountId)).toBe(before + 5000);

    const rev = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Monto cargado por error' });
    expect(rev.status).toBe(201);
    expect(rev.body.data.type).toBe('expense');
    expect(Number(rev.body.data.amount)).toBe(5000);
    expect(rev.body.data.reversal_of_id).toBe(txId);

    expect(await accountBalance(accountId)).toBe(before); // vuelve exacto al valor previo

    const original = await CashTransaction.findByPk(txId);
    expect(original!.status).toBe('reversed');
    expect(original!.reversed_at).not.toBeNull();
    expect(original!.reversed_by).not.toBeNull();
    // El original NUNCA cambia sus campos financieros.
    expect(Number(original!.amount)).toBe(5000);
    expect(original!.type).toBe('income');
  });

  it('revertir una transferencia invierte cuenta origen y destino correctamente', async () => {
    const beforeA = await accountBalance(accountId);
    const beforeB = await accountBalance(accountBId);

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, transfer_account_id: accountBId, category_id: categoryId,
      type: 'transfer', amount: 2000, description: 'Transferencia QA', date: TODAY,
    });
    const txId = tx.body.data.id;
    expect(await accountBalance(accountId)).toBe(beforeA - 2000);
    expect(await accountBalance(accountBId)).toBe(beforeB + 2000);

    await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Transferencia a la cuenta equivocada' });

    expect(await accountBalance(accountId)).toBe(beforeA);
    expect(await accountBalance(accountBId)).toBe(beforeB);
  });

  // ── Reversión parcial ──────────────────────────────────────────────────────

  it('reversión parcial: el original queda activo hasta cubrir el monto total', async () => {
    const txId = await createTx(1000);

    const rev1 = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Devolución parcial 1 de 2', amount: 400 });
    expect(rev1.status).toBe(201);
    expect(Number(rev1.body.data.amount)).toBe(400);

    let original = await CashTransaction.findByPk(txId);
    expect(original!.status).toBe('active'); // todavía queda $600 sin revertir

    const rev2 = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Devolución parcial 2 de 2', amount: 600 });
    expect(rev2.status).toBe(201);

    original = await CashTransaction.findByPk(txId);
    expect(original!.status).toBe('reversed'); // ahora sí, ya no queda nada por revertir
  });

  it('no se puede revertir más de lo que queda sin revertir', async () => {
    const txId = await createTx(1000);

    await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Devolución parcial', amount: 700 });

    const res = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Intento de revertir de más', amount: 400 }); // solo quedan $300
    expect(res.status).toBe(400);
  });

  // ── Reglas de una sola reversión / no encadenar ────────────────────────────

  it('una transacción ya revertida por completo no se puede volver a revertir', async () => {
    const txId = await createTx(500);
    await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Primera reversión, por el total' });

    const res = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Segundo intento sobre lo mismo' });
    expect(res.status).toBe(400);
  });

  it('una reversión (el contraasiento) no se puede volver a revertir', async () => {
    const txId = await createTx(500);
    const rev = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversión original' });

    const res = await api().post(`${API}/cash/transactions/${rev.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Intentando revertir la reversión' });
    expect(res.status).toBe(400);
  });

  it('el motivo es obligatorio y tiene un mínimo de 10 caracteres', async () => {
    const txId = await createTx(500);
    const res = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'corto' });
    expect(res.status).toBe(422); // validador de ruta (express-validator), no regla de negocio
  });

  // ── PUT/DELETE eliminados de la API ────────────────────────────────────────

  it('PUT /cash/transactions/:id ya no existe', async () => {
    const txId = await createTx(100);
    const res = await api().put(`${API}/cash/transactions/${txId}`).set(...auth(admin)).send({ amount: 999 });
    expect([404, 405]).toContain(res.status);
  });

  it('DELETE /cash/transactions/:id ya no existe', async () => {
    const txId = await createTx(100);
    const res = await api().delete(`${API}/cash/transactions/${txId}`).set(...auth(admin));
    expect([404, 405]).toContain(res.status);
  });

  // ── PATCH: solo campos no financieros ──────────────────────────────────────

  it('PATCH no cambia amount/type/account_id/date aunque se envíen en el body', async () => {
    const txId = await createTx(1234);

    const res = await api().patch(`${API}/cash/transactions/${txId}`).set(...auth(admin)).send({
      description: 'Descripción actualizada',
      amount: 999999,        // debe ser ignorado
      type: 'expense',       // debe ser ignorado
      account_id: accountBId, // debe ser ignorado
      date: '2000-01-01',    // debe ser ignorado
    });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Descripción actualizada');
    expect(Number(res.body.data.amount)).toBe(1234);
    expect(res.body.data.type).toBe('income');
    expect(res.body.data.account_id).toBe(accountId);
  });

  // ── Idempotencia ────────────────────────────────────────────────────────────

  it('dos altas secuenciales con la misma idempotency_key crean un único movimiento', async () => {
    const key = `qa-idem-${Date.now()}`;
    const payload = {
      account_id: accountId, category_id: categoryId, type: 'income' as const,
      amount: 300, description: 'Idempotencia secuencial', date: TODAY,
      idempotency_key: key,
    };

    const r1 = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send(payload);
    const r2 = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send(payload);

    expect(r1.body.data.id).toBe(r2.body.data.id);
    const count = await CashTransaction.count({ where: { idempotency_key: key } });
    expect(count).toBe(1);
  });

  it('dos altas CONCURRENTES con la misma idempotency_key no duplican el movimiento', async () => {
    const key = `qa-idem-race-${Date.now()}`;
    const payload = {
      account_id: accountId, category_id: categoryId, type: 'income' as const,
      amount: 150, description: 'Idempotencia concurrente', date: TODAY,
      idempotency_key: key,
    };

    const [r1, r2] = await Promise.all([
      api().post(`${API}/cash/transactions`).set(...auth(admin)).send(payload),
      api().post(`${API}/cash/transactions`).set(...auth(admin)).send(payload),
    ]);

    expect([r1.status, r2.status]).toEqual([201, 201]); // ambas respuestas exitosas...
    expect(r1.body.data.id).toBe(r2.body.data.id);       // ...pero es el mismo movimiento
    const count = await CashTransaction.count({ where: { idempotency_key: key } });
    expect(count).toBe(1);
  });

  // ── Filtro por status ───────────────────────────────────────────────────────

  it('GET /cash/transactions filtra por status y por defecto muestra activas y revertidas', async () => {
    const txId = await createTx(50);
    await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Para probar el filtro de status' });

    const onlyReversed = await api()
      .get(`${API}/cash/transactions?account_id=${accountId}&status=reversed&limit=100`)
      .set(...auth(admin));
    const idsReversed = onlyReversed.body.data.map((t: { id: number }) => t.id);
    expect(idsReversed).toContain(txId);

    const onlyActive = await api()
      .get(`${API}/cash/transactions?account_id=${accountId}&status=active&limit=100`)
      .set(...auth(admin));
    const idsActive = onlyActive.body.data.map((t: { id: number }) => t.id);
    expect(idsActive).not.toContain(txId);
  });
});
