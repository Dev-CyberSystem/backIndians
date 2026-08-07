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

  // ── CASH-RPT-002 / DEC-013 ──────────────────────────────────────────────
  //
  // `by_category` ya neteaba desde CASH-RPT-001, pero `total_income` y
  // `total_expense` del período sumaban TODO lo que tuviera ese `type`, sin
  // distinguir el original del contraasiento. Como una reversión de un
  // ingreso se crea como movimiento `expense` (y viceversa), un ingreso de
  // $5.000 revertido inflaba +$5.000 a ingresos Y +$5.000 a egresos —
  // `net_balance` daba bien igual, por cancelarse entre sí, pero el panel
  // mostraba plata que ya no existía.
  //
  // DEC-013 fija el criterio: neto, COMPENSANDO POR SIGNO, no excluyendo
  // filas. La diferencia entre los dos criterios solo se nota en una
  // reversión PARCIAL — es el caso que prueban estos tests, no el de
  // reversión total (que da igual con cualquiera de los dos).

  async function periodSummary() {
    const res = await api().get(`${API}/cash/summary?period=last30`).set(...auth(admin));
    return res.body.data as {
      total_income: number;
      total_expense: number;
      daily_evolution: Array<{ date: string; income: number; expense: number }>;
    };
  }

  it('un ingreso revertido POR COMPLETO no infla total_income ni total_expense', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Totales QA ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Totales QA ${Date.now()}`, type: 'both' });

    const before = await periodSummary();

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'income',
      amount: 5000, description: 'Ingreso que se revierte del todo', date: TODAY,
    });
    await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion total para medir los totales del periodo' });

    const after = await periodSummary();

    // Antes: delta_income=+5000, delta_expense=+5000 (net_balance daba 0 igual).
    expect(after.total_income - before.total_income).toBe(0);
    expect(after.total_expense - before.total_expense).toBe(0);
  });

  it('un egreso revertido por completo tampoco infla los totales (caso simétrico)', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Totales QA2 ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Totales QA2 ${Date.now()}`, type: 'both' });

    // El movimiento necesita saldo para poder egresar.
    await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'income',
      amount: 10000, description: 'Fondeo previo', date: TODAY,
    });

    const before = await periodSummary();

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'expense',
      amount: 2000, description: 'Egreso que se revierte del todo', date: TODAY,
    });
    await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion total simetrica' });

    const after = await periodSummary();

    expect(after.total_income - before.total_income).toBe(0);
    expect(after.total_expense - before.total_expense).toBe(0);
  });

  it('una reversión PARCIAL deja el remanente vigente, no hace desaparecer todo (el caso que distingue excluir de compensar)', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Parcial QA ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Parcial QA ${Date.now()}`, type: 'both' });

    const before = await periodSummary();

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'income',
      amount: 1000, description: 'Ingreso con reversion parcial', date: TODAY,
    });
    await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion parcial de 400 sobre 1000', amount: 400 });

    const after = await periodSummary();

    // Con exclusión de filas esto daría 0 (desaparece el movimiento entero).
    // Compensando por signo (DEC-013) queda el remanente real: 1000 − 400 = 600.
    expect(after.total_income - before.total_income).toBe(600);
    expect(after.total_expense - before.total_expense).toBe(0);
  });

  it('daily_evolution del día de hoy sigue el mismo criterio de neteo que los totales', async () => {
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Cuenta Diario QA ${Date.now()}`, type: 'cash' });
    const cat = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Cat Diario QA ${Date.now()}`, type: 'both' });

    const dayRowOf = (rows: Array<{ date: string; income: number; expense: number }>) =>
      rows.find((r) => r.date === TODAY) ?? { date: TODAY, income: 0, expense: 0 };

    const before = dayRowOf((await periodSummary()).daily_evolution);

    const tx = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: acc.body.data.id, category_id: cat.body.data.id, type: 'income',
      amount: 900, description: 'Ingreso con reversion parcial mismo dia', date: TODAY,
    });
    // El contraasiento se fecha en la jornada de negocio de HOY (businessDate()),
    // así que la reversión cae en la misma fila del día que el original.
    await api().post(`${API}/cash/transactions/${tx.body.data.id}/reverse`).set(...auth(admin))
      .send({ reason: 'Reversion parcial de 300 sobre 900, mismo dia', amount: 300 });

    const after = dayRowOf((await periodSummary()).daily_evolution);

    expect(after.income - before.income).toBe(600); // 900 − 300
    expect(after.expense - before.expense).toBe(0);
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
