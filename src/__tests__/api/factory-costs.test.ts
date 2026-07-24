import { api, API, loginAs, auth } from './helpers';

/*
 * Costos de prendas: asignación de categoría, carga/edición con versionado,
 * historial, congelado del pedido y autorización por rol.
 * Requiere DB migrada + seeders (npm run seed).
 */

describe('Costos de prendas — API', () => {
  let admin: string;
  let clientId: number;
  let garmentTypeId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    // Crea un tipo de prenda FRESCO para este cliente, así el versionado de costos
    // arranca en 1 y el test es idempotente aunque la DB ya tenga datos.
    const gt = await api().post(`${API}/master/garment-types`).set(...auth(admin))
      .send({ name: `QA Costos ${Date.now()}`, client_id: clientId });
    garmentTypeId = gt.body.data.id;

    // Asigna categoría de costo (necesaria para cargar costos)
    await api().put(`${API}/master/garment-types/${garmentTypeId}/cost-category`)
      .set(...auth(admin)).send({ cost_category: 'jersey' });
  });

  it('lista los ítems de costo de la categoría jersey', async () => {
    const res = await api().get(`${API}/costs/items?category=jersey`).set(...auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.some((i: any) => i.key === 'tela_principal')).toBe(true);
  });

  it('devuelve la hoja de costos con los ítems del maestro y total 0 inicial', async () => {
    const res = await api().get(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`).set(...auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.category).toBe('jersey');
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('guarda costos y crea la versión 1', async () => {
    const res = await api().put(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`)
      .set(...auth(admin)).send({
        items: [
          { key: 'tela_principal', amount: 1000.50 },
          { key: 'hilos', amount: 200 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.total_cost).toBeCloseTo(1200.50, 2);
    expect(res.body.data.version_number).toBe(1);
  });

  it('editar costos genera una versión nueva sin pisar la anterior', async () => {
    const res = await api().put(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`)
      .set(...auth(admin)).send({
        items: [
          { key: 'tela_principal', amount: 1500 },
          { key: 'hilos', amount: 200 },
          { key: 'cuello_lycra', amount: 350.25 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.version_number).toBe(2);
    expect(res.body.data.total_cost).toBeCloseTo(2050.25, 2);

    const hist = await api().get(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}/history`).set(...auth(admin));
    expect(hist.status).toBe(200);
    expect(hist.body.data.versions.length).toBe(2);
  });

  it('congela el detalle de costos del pedido y no lo altera un cambio posterior', async () => {
    // Costo vigente = 2050.25. Crear pedido de 3 unidades de esa prenda.
    const order = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'Azul', sizes: { M: 3 }, unit_price: 10000 }],
    });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id;

    const before = await api().get(`${API}/costs/orders/${orderId}`).set(...auth(admin));
    expect(before.status).toBe(200);
    expect(before.body.data.detail.length).toBe(1);
    expect(before.body.data.detail[0].unit_cost).toBeCloseTo(2050.25, 2);
    expect(before.body.data.detail[0].line_total).toBeCloseTo(6150.75, 2);
    expect(before.body.data.total).toBeCloseTo(6150.75, 2);

    // Cambiar los costos DESPUÉS de crear el pedido
    await api().put(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`)
      .set(...auth(admin)).send({ items: [{ key: 'tela_principal', amount: 99999 }] });

    // El detalle del pedido sigue congelado
    const after = await api().get(`${API}/costs/orders/${orderId}`).set(...auth(admin));
    expect(after.body.data.detail[0].unit_cost).toBeCloseTo(2050.25, 2);
  });

  it('un vendedor no puede ver ni cargar costos (403)', async () => {
    const seller = await loginAs('seller');
    const read = await api().get(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`).set(...auth(seller));
    expect(read.status).toBe(403);
    const write = await api().put(`${API}/costs/clients/${clientId}/garments/${garmentTypeId}`)
      .set(...auth(seller)).send({ items: [{ key: 'hilos', amount: 100 }] });
    expect(write.status).toBe(403);
  });
});
