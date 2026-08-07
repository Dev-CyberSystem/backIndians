import { api, API, loginAs, auth } from './helpers';

/*
 * Correcciones P0 de la auditoría de verificación
 * (`AUDITORIA_FLUJO_CAJA_VERIFICACION_2026-08-07.md`):
 *
 *  - CASH-VAL-004: una cuenta desactivada aceptaba movimientos nuevos Y su
 *    saldo desaparecía del resumen — juntos permitían mover plata a una
 *    cuenta invisible en el panel.
 *  - CASH-RPT-001: `by_category` sumaba ingresos y egresos con el mismo signo,
 *    así que revertir un movimiento DUPLICABA su valor en el gráfico de
 *    egresos en vez de anularlo.
 *
 * Estos frentes (validación de entrada y reportes) no tenían ninguna cobertura
 * antes — por eso los 238 tests previos pasaban con ambos defectos vivos.
 */

const TODAY = new Date().toISOString().slice(0, 10);

describe('Validación de cuentas y contabilidad del resumen — P0 de verificación', () => {
  let admin: string;
  let activeAccount: number;
  let inactiveAccount: number;
  let category: number;

  beforeAll(async () => {
    admin = await loginAs('admin');

    const a = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Activa QA ${Date.now()}`, type: 'cash' });
    activeAccount = a.body.data.id;

    const b = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Inactiva QA ${Date.now()}`, type: 'cash' });
    inactiveAccount = b.body.data.id;

    const c = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Verificacion QA ${Date.now()}`, type: 'both' });
    category = c.body.data.id;
  });

  async function balanceOf(id: number): Promise<number> {
    const res = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    return Number((res.body.data as Array<{ id: number; current_balance: number }>).find((x) => x.id === id)!.current_balance);
  }

  // ── CASH-VAL-004 ────────────────────────────────────────────────────────

  it('una cuenta desactivada NO acepta movimientos nuevos', async () => {
    // Se le carga saldo mientras todavía está activa.
    const seed = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: inactiveAccount, category_id: category, type: 'income',
      amount: 2500, description: 'Saldo previo a desactivar', date: TODAY,
    });
    expect(seed.status).toBe(201);

    const toggle = await api().patch(`${API}/cash/accounts/${inactiveAccount}/toggle`).set(...auth(admin));
    expect(toggle.status).toBe(200);
    expect(toggle.body.data.active).toBe(false);

    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: inactiveAccount, category_id: category, type: 'income',
      amount: 100, description: 'No deberia entrar', date: TODAY,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/desactivada/i);
  });

  it('no se puede transferir HACIA una cuenta desactivada', async () => {
    const res = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: activeAccount, transfer_account_id: inactiveAccount, category_id: category,
      type: 'transfer', amount: 100, description: 'Transferencia a cuenta de baja', date: TODAY,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/desactivada/i);
  });

  it('una cuenta desactivada CON saldo sigue apareciendo en el resumen, marcada como inactiva', async () => {
    const summary = await api().get(`${API}/cash/summary?period=last30`).set(...auth(admin));
    expect(summary.status).toBe(200);

    const row = (summary.body.data.accounts as Array<{ id: number; active: boolean; current_balance: number }>)
      .find((a) => a.id === inactiveAccount);

    // Sin esto, los $2500 desaparecían del "Saldo total" del panel pese a
    // seguir existiendo en la base.
    expect(row).toBeDefined();
    expect(row!.active).toBe(false);
    expect(Number(row!.current_balance)).toBe(2500);
  });

  it('una cuenta desactivada SIN saldo no ensucia el resumen', async () => {
    const empty = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Vacia QA ${Date.now()}`, type: 'cash' });
    const emptyId = empty.body.data.id;
    await api().patch(`${API}/cash/accounts/${emptyId}/toggle`).set(...auth(admin));

    const summary = await api().get(`${API}/cash/summary?period=last30`).set(...auth(admin));
    const ids = (summary.body.data.accounts as Array<{ id: number }>).map((a) => a.id);
    expect(ids).not.toContain(emptyId);
  });

  it('revertir un movimiento de una cuenta ya desactivada sigue siendo posible', async () => {
    // Regla deliberada: la validación de cuenta activa vive en el alta, no en
    // la reversión — un movimiento siempre se tiene que poder corregir aunque
    // su cuenta se haya dado de baja después.
    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: activeAccount, category_id: category, type: 'income',
      amount: 900, description: 'Se revierte con la cuenta de baja', date: TODAY,
    });
    const txId = tx.body.data.id;

    await api().patch(`${API}/cash/accounts/${activeAccount}/toggle`).set(...auth(admin));
    const rev = await api().post(`${API}/cash/transactions/${txId}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion con la cuenta desactivada' });
    expect(rev.status).toBe(201);

    await api().patch(`${API}/cash/accounts/${activeAccount}/toggle`).set(...auth(admin)); // se reactiva
  });

  // ── CASH-RPT-001 ────────────────────────────────────────────────────────

  it('un movimiento revertido NETEA a cero en by_category (antes lo duplicaba)', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Reporte QA ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Reporte QA ${Date.now()}`, type: 'both' });

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'income',
      amount: 7000, description: 'Ingreso que se revierte', date: TODAY,
    });
    await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Anulacion para medir el reporte' });

    const summary = await api().get(`${API}/cash/summary?period=last30`).set(...auth(admin));
    const row = (summary.body.data.by_category as Array<{ category_id: number; total: number }>)
      .find((c) => c.category_id === cat.body.data.id);

    // Antes daba 14000: el original y su contraasiento se sumaban en vez de anularse.
    expect(Number(row?.total ?? 0)).toBe(0);
  });

  it('by_category netea egresos contra ingresos de la misma categoría', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Neteo QA ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Neteo QA ${Date.now()}`, type: 'both' });
    const accId = acc.body.data.id;
    const catId = cat.body.data.id;

    await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accId, category_id: catId, type: 'income',
      amount: 3000, description: 'Ingreso de la categoria', date: TODAY,
    });
    await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accId, category_id: catId, type: 'expense',
      amount: 5000, description: 'Egreso de la categoria', date: TODAY,
    });

    const summary = await api().get(`${API}/cash/summary?period=last30`).set(...auth(admin));
    const row = (summary.body.data.by_category as Array<{ category_id: number; total: number }>)
      .find((c) => c.category_id === catId);

    expect(Number(row!.total)).toBe(2000); // 5000 de egreso − 3000 de ingreso
  });

  it('el saldo de la cuenta no cambia por ninguna de estas validaciones', async () => {
    // Guarda contra que un rechazo deje el saldo tocado a medias.
    const before = await balanceOf(inactiveAccount);
    await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: inactiveAccount, category_id: category, type: 'income',
      amount: 777, description: 'Rechazado, no debe mover el saldo', date: TODAY,
    });
    expect(await balanceOf(inactiveAccount)).toBe(before);
  });
});
