import { api, API, loginAs, auth } from './helpers';

/*
 * Pedidos de producción con el flujo de controles + checklist obligatorio.
 * Crea un pedido, lo lleva hasta el primer control, valida que NO se puede
 * avanzar sin completar el checklist, lo completa, avanza, y prueba la
 * observación (volver al control anterior). Historial y transiciones inválidas.
 */

describe('Pedidos de producción + checklist — API', () => {
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

  async function createOrder() {
    const res = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'Azul', sizes: { M: 5 }, unit_price: 10000 }],
    });
    return res.body.data.id as number;
  }

  async function setStatus(id: number, status: string, comment = 'QA') {
    return api().put(`${API}/orders/${id}`).set(...auth(admin)).send({ status, status_comment: comment });
  }

  it('crea un pedido en estado "pending"', async () => {
    const id = await createOrder();
    expect(id).toBeTruthy();
  });

  it('llega al primer control y exige el checklist para avanzar', async () => {
    const id = await createOrder();

    // pending → under_review → workshop_review → raw_material_control
    expect((await setStatus(id, 'under_review')).status).toBe(200);
    expect((await setStatus(id, 'workshop_review')).status).toBe(200);
    expect((await setStatus(id, 'raw_material_control')).status).toBe(200);

    // El checklist del control aparece y arranca vacío
    const cl = await api().get(`${API}/orders/${id}/checklist`).set(...auth(admin));
    expect(cl.status).toBe(200);
    expect(cl.body.data.is_control).toBe(true);
    expect(cl.body.data.total).toBeGreaterThan(0);
    expect(cl.body.data.done).toBe(0);

    // No se puede avanzar sin completar el checklist
    const blocked = await setStatus(id, 'cutting_control');
    expect(blocked.status).toBe(400);

    // Tildar todos los ítems
    for (const item of cl.body.data.items) {
      const r = await api().post(`${API}/orders/${id}/checklist`).set(...auth(admin))
        .send({ item_key: item.key, checked: true });
      expect(r.status).toBe(200);
    }

    // Ahora sí avanza
    const ok = await setStatus(id, 'cutting_control');
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('cutting_control');
  });

  it('al observar vuelve al control anterior y reinicia su checklist', async () => {
    const id = await createOrder();
    await setStatus(id, 'under_review');
    await setStatus(id, 'workshop_review');
    await setStatus(id, 'raw_material_control');

    // Completar materias primas y avanzar a corte
    let cl = await api().get(`${API}/orders/${id}/checklist`).set(...auth(admin));
    for (const item of cl.body.data.items) {
      await api().post(`${API}/orders/${id}/checklist`).set(...auth(admin)).send({ item_key: item.key, checked: true });
    }
    expect((await setStatus(id, 'cutting_control')).status).toBe(200);

    // Observar: volver a materias primas con comentario
    const back = await setStatus(id, 'raw_material_control', 'Faltó verificar la tela');
    expect(back.status).toBe(200);

    // El checklist de materias primas quedó reiniciado (se rehace)
    cl = await api().get(`${API}/orders/${id}/checklist`).set(...auth(admin));
    expect(cl.body.data.status).toBe('raw_material_control');
    expect(cl.body.data.done).toBe(0);
  });

  it('rechaza un salto de estado inválido (pending → ready)', async () => {
    const id = await createOrder();
    const res = await setStatus(id, 'ready');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('un vendedor no puede mover un pedido a un control', async () => {
    const id = await createOrder();
    await setStatus(id, 'under_review');
    await setStatus(id, 'workshop_review');
    const seller = await loginAs('seller');
    const res = await api().put(`${API}/orders/${id}`).set(...auth(seller))
      .send({ status: 'raw_material_control', status_comment: 'no permitido' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('registra el historial con quién y cuándo', async () => {
    const id = await createOrder();
    await setStatus(id, 'under_review');
    const history = await api().get(`${API}/orders/${id}/history`).set(...auth(admin));
    expect(history.status).toBe(200);
    const entries = history.body.data?.rows ?? history.body.data ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].changed_by ?? entries[0].changer?.id).toBeTruthy();
  });
});
