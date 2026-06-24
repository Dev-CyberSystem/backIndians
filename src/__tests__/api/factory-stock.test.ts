import { api, API, loginAs, auth } from './helpers';

/*
 * Control de stock de insumos: alta de un insumo, movimientos de entrada/salida
 * que ajustan la cantidad, métricas, y autorización (alta solo admin/facturación).
 */

describe('Stock de insumos — API', () => {
  let admin: string;
  let itemId: number;

  beforeAll(async () => { admin = await loginAs('admin'); });

  it('da de alta un insumo', async () => {
    const res = await api().post(`${API}/stock`).set(...auth(admin)).send({
      name: `Insumo QA ${Date.now()}`,
      unit: 'metro',
      current_quantity: 100,
      min_quantity: 10,
    });
    expect(res.status).toBe(201);
    itemId = res.body.data?.id;
    expect(itemId).toBeTruthy();
    expect(Number(res.body.data?.current_quantity)).toBe(100);
  });

  it('un movimiento de entrada suma stock', async () => {
    const res = await api().post(`${API}/stock/movements`).set(...auth(admin))
      .send({ stock_item_id: itemId, type: 'in', quantity: 50, notes: 'Compra' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(Number(res.body.data?.current_quantity)).toBe(150);
  });

  it('un movimiento de salida resta stock', async () => {
    const res = await api().post(`${API}/stock/movements`).set(...auth(admin))
      .send({ stock_item_id: itemId, type: 'out', quantity: 30, notes: 'Consumo producción' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(Number(res.body.data?.current_quantity)).toBe(120);
  });

  it('las métricas de stock responden', async () => {
    const res = await api().get(`${API}/stock/metrics`).set(...auth(admin));
    expect(res.status).toBe(200);
  });

  it('el taller no puede dar de alta insumos', async () => {
    const workshop = await loginAs('workshop');
    const res = await api().post(`${API}/stock`).set(...auth(workshop))
      .send({ name: 'X', unit: 'unidad', current_quantity: 1 });
    expect([401, 403]).toContain(res.status);
  });
});
