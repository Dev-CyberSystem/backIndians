import { api, API, loginAs, auth } from './helpers';

/*
 * Control de caja: cuentas, categorías y movimientos de ingreso/egreso.
 * Se usa una cuenta nueva (balance 0) para verificar de forma aislada que
 * ingreso − egreso queda reflejado en el balance y en el resumen.
 */

const TODAY = new Date().toISOString().slice(0, 10);

describe('Caja — API', () => {
  let admin: string;
  let accountId: number;
  let incomeCat: number;
  let expenseCat: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const acc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja QA ${Date.now()}`, type: 'cash' });
    accountId = acc.body.data?.id;
    const ci = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Ventas QA ${Date.now()}`, type: 'income' });
    incomeCat = ci.body.data?.id;
    const ce = await api().post(`${API}/cash/categories`).set(...auth(admin))
      .send({ name: `Gastos QA ${Date.now()}`, type: 'expense' });
    expenseCat = ce.body.data?.id;
  });

  it('crea la cuenta y las categorías de caja', () => {
    expect(accountId).toBeTruthy();
    expect(incomeCat).toBeTruthy();
    expect(expenseCat).toBeTruthy();
  });

  it('registra un ingreso y un egreso', async () => {
    const income = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: incomeCat, type: 'income',
      amount: 100000, description: 'Cobro de pedido', date: TODAY,
    });
    expect(income.status).toBe(201);

    const expense = await api().post(`${API}/cash/transactions`).set(...auth(admin)).send({
      account_id: accountId, category_id: expenseCat, type: 'expense',
      amount: 40000, description: 'Compra de tela', date: TODAY,
    });
    expect(expense.status).toBe(201);
  });

  it('el balance de la cuenta refleja ingreso − egreso (60.000)', async () => {
    const res = await api().get(`${API}/cash/summary`).set(...auth(admin));
    expect(res.status).toBe(200);
    const mine = (res.body.data?.accounts ?? []).find((a: any) => a.id === accountId);
    expect(mine).toBeTruthy();
    expect(Number(mine.current_balance)).toBe(60000);
  });

  it('ventas (seller) no tiene acceso a caja', async () => {
    const seller = await loginAs('seller');
    const res = await api().get(`${API}/cash/summary`).set(...auth(seller));
    expect([401, 403]).toContain(res.status);
  });
});
