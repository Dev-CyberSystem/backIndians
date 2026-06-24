import { api, API, loginAs, auth } from './helpers';

/*
 * Pedidos de producción y su flujo de estados. Crea un pedido, lo recorre por
 * toda la cadena de fabricación con el admin, valida el historial, y comprueba
 * que las transiciones inválidas y los saltos no permitidos por rol se rechazan.
 */

// Cadena feliz que el admin puede recorrer de punta a punta.
const CHAIN = ['under_review', 'workshop_review', 'in_production', 'sewing', 'stamping', 'quality_check', 'ready'] as const;

describe('Pedidos de producción — API', () => {
  let admin: string;
  let clientId: number;
  let garmentTypeId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
    const gts = await api().get(`${API}/master/garment-types`).set(...auth(admin));
    garmentTypeId = (gts.body.data?.rows ?? gts.body.data)[0].id;
  });

  async function createOrder(token = admin) {
    const res = await api().post(`${API}/orders`).set(...auth(token)).send({
      client_id: clientId,
      notes: 'Pedido QA',
      items: [{ garment_type_id: garmentTypeId, color: 'Azul', sizes: { M: 5, L: 3 }, unit_price: 10000 }],
    });
    return res;
  }

  it('crea un pedido en estado inicial "pending"', async () => {
    const res = await createOrder();
    expect(res.status).toBe(201);
    expect(res.body.data?.id).toBeTruthy();
    expect(res.body.data?.status).toBe('pending');
  });

  it('recorre toda la cadena de fabricación hasta "ready"', async () => {
    const created = await createOrder();
    const id = created.body.data.id;

    for (const next of CHAIN) {
      const res = await api().put(`${API}/orders/${id}`).set(...auth(admin))
        .send({ status: next, status_comment: `→ ${next}` });
      expect(res.status).toBe(200);
      expect(res.body.data?.status).toBe(next);
    }

    // El historial registró los cambios de estado
    const history = await api().get(`${API}/orders/${id}/history`).set(...auth(admin));
    expect(history.status).toBe(200);
    const entries = history.body.data?.rows ?? history.body.data ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(CHAIN.length);
  });

  it('rechaza un salto de estado inválido (pending → ready)', async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    const res = await api().put(`${API}/orders/${id}`).set(...auth(admin))
      .send({ status: 'ready', status_comment: 'salto inválido' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('un vendedor no puede mover un pedido de pending a under_review', async () => {
    const created = await createOrder();
    const id = created.body.data.id;
    const seller = await loginAs('seller');
    const res = await api().put(`${API}/orders/${id}`).set(...auth(seller))
      .send({ status: 'under_review', status_comment: 'no permitido' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
