import { api, API, loginAs, auth } from './helpers';
import { CashAuditEvent } from '../../models/CashAuditEvent';

/*
 * Auditoría inmutable del módulo de caja (Fase 1 del plan de corrección —
 * hallazgo CASH-AUDIT-001). Verifica que toda mutación deje rastro con
 * valores antes/después, que la tabla no se pueda alterar ni siquiera desde
 * código interno, y que la consulta esté restringida a admin.
 */

const TODAY = new Date().toISOString().slice(0, 10);

describe('Auditoría de caja — Fase 1', () => {
  let admin: string;
  let accountId: number;
  let categoryId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');

    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja Audit QA ${Date.now()}`, type: 'cash' });
    accountId = acc.body.data.id;

    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Audit QA ${Date.now()}`, type: 'income' });
    categoryId = cat.body.data.id;
  });

  // ── Cobertura de eventos ───────────────────────────────────────────────────

  it('crear una cuenta deja un evento con el estado resultante', async () => {
    const events = await CashAuditEvent.findAll({
      where: { entity_type: 'account', entity_id: accountId, action: 'create' },
    });
    expect(events).toHaveLength(1);

    const after = events[0].after_json as Record<string, unknown>;
    expect(after.name).toContain('Caja Audit QA');
    expect(after.type).toBe('cash');
    expect(events[0].before_json).toBeNull(); // un alta no tiene "antes"
    expect(events[0].user_id).toBeTruthy();
  });

  it('crear una categoría deja su propio evento', async () => {
    const events = await CashAuditEvent.findAll({
      where: { entity_type: 'category', entity_id: categoryId, action: 'create' },
    });
    expect(events).toHaveLength(1);
    expect((events[0].after_json as Record<string, unknown>).type).toBe('income');
  });

  it('editar una cuenta guarda el valor anterior y el nuevo', async () => {
    const nuevoNombre = `Caja Renombrada ${Date.now()}`;
    await api().put(`${API}/cash/accounts/${accountId}`).set(...auth(admin))
      .send({ name: nuevoNombre });

    const ev = await CashAuditEvent.findOne({
      where: { entity_type: 'account', entity_id: accountId, action: 'update' },
      order: [['id', 'DESC']],
    });
    expect(ev).not.toBeNull();

    const before = ev!.before_json as Record<string, unknown>;
    const after  = ev!.after_json  as Record<string, unknown>;
    expect(before.name).toContain('Caja Audit QA');   // el nombre original
    expect(after.name).toBe(nuevoNombre);             // el nuevo
  });

  it('crear un movimiento deja evento con monto y cuenta', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: categoryId, type: 'income',
      amount: 12345.67, description: 'Movimiento auditado', date: TODAY,
    });
    expect(tx.status).toBe(201);

    const ev = await CashAuditEvent.findOne({
      where: { entity_type: 'transaction', entity_id: tx.body.data.id, action: 'create' },
    });
    expect(ev).not.toBeNull();

    const after = ev!.after_json as Record<string, unknown>;
    expect(Number(after.amount)).toBe(12345.67);
    expect(after.account_id).toBe(accountId);
  });

  it('editar la descripción (PATCH) deja registrado el valor anterior — el monto no se toca así (Fase 2)', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: categoryId, type: 'income',
      amount: 1000, description: 'Descripción original', date: TODAY,
    });
    const txId = tx.body.data.id;

    await api().patch(`${API}/cash/transactions/${txId}`).set(...auth(admin))
      .send({ description: 'Descripción corregida' });

    const ev = await CashAuditEvent.findOne({
      where: { entity_type: 'transaction', entity_id: txId, action: 'update' },
      order: [['id', 'DESC']],
    });
    expect(ev).not.toBeNull();
    expect((ev!.before_json as Record<string, unknown>).description).toBe('Descripción original');
    expect((ev!.after_json  as Record<string, unknown>).description).toBe('Descripción corregida');
    // El monto es idéntico antes y después: PATCH no lo toca (Fase 2 — CASH-MUT-001).
    expect(Number((ev!.before_json as Record<string, unknown>).amount)).toBe(1000);
    expect(Number((ev!.after_json  as Record<string, unknown>).amount)).toBe(1000);
  });

  it('revertir un movimiento deja dos eventos de auditoría con motivo (Fase 2)', async () => {
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: categoryId, type: 'income',
      amount: 777, description: 'Movimiento a revertir', date: TODAY,
    });
    const txId = tx.body.data.id;

    const rev = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Cargado en la cuenta equivocada' });
    expect(rev.status).toBe(201);

    const evOriginal = await CashAuditEvent.findOne({
      where: { entity_type: 'transaction', entity_id: txId, action: 'reverse' },
    });
    expect(evOriginal).not.toBeNull();
    expect(evOriginal!.reason).toBe('Cargado en la cuenta equivocada');
    expect((evOriginal!.before_json as Record<string, unknown>).status).toBe('active');
    expect((evOriginal!.after_json  as Record<string, unknown>).status).toBe('reversed');

    const evReversal = await CashAuditEvent.findOne({
      where: { entity_type: 'transaction', entity_id: rev.body.data.id, action: 'reverse' },
    });
    expect(evReversal).not.toBeNull();
    expect(evReversal!.before_json).toBeNull(); // el contraasiento es un alta, no tiene "antes"
  });

  // ── Inmutabilidad ──────────────────────────────────────────────────────────

  it('un evento de auditoría no se puede modificar ni borrar, ni desde código interno', async () => {
    const ev = await CashAuditEvent.findOne({ order: [['id', 'DESC']] });
    expect(ev).not.toBeNull();

    await expect(ev!.update({ reason: 'intento de manipulación' })).rejects.toThrow(/append-only/);
    await expect(ev!.destroy()).rejects.toThrow(/append-only/);
    await expect(
      CashAuditEvent.destroy({ where: { id: ev!.id } })
    ).rejects.toThrow(/append-only/);
  });

  it('la tabla no tiene updatedAt: una fila no se actualiza nunca', () => {
    expect(Object.keys(CashAuditEvent.getAttributes())).not.toContain('updatedAt');
  });

  // ── Acceso ─────────────────────────────────────────────────────────────────

  it('el admin puede consultar la auditoría', async () => {
    const res = await api().get(`${API}/cash/audit?limit=5`).set(...auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });

  it('billing tiene acceso a caja pero NO a la auditoría', async () => {
    const billing = await loginAs('billing');
    const caja = await api().get(`${API}/cash/summary`).set(...auth(billing));
    expect(caja.status).toBe(200); // sigue operando caja con normalidad

    const audit = await api().get(`${API}/cash/audit`).set(...auth(billing));
    expect(audit.status).toBe(403);
  });

  it('no existe ningún endpoint para escribir o borrar auditoría', async () => {
    const post = await api().post(`${API}/cash/audit`).set(...auth(admin)).send({});
    expect([404, 405]).toContain(post.status);

    const del = await api().delete(`${API}/cash/audit/1`).set(...auth(admin));
    expect([404, 405]).toContain(del.status);
  });

  // ── Atomicidad ─────────────────────────────────────────────────────────────

  it('si la operación falla, no queda evento huérfano', async () => {
    const antes = await CashAuditEvent.count({ where: { entity_type: 'transaction' } });

    // Cuenta inexistente → el servicio tira 404 y revierte toda la transacción
    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: 99999999, category_id: categoryId, type: 'income',
      amount: 500, description: 'Debe fallar', date: TODAY,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const despues = await CashAuditEvent.count({ where: { entity_type: 'transaction' } });
    expect(despues).toBe(antes);
  });
});
