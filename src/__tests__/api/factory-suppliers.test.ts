import { api, API, loginAs, auth } from './helpers';

/*
 * Proveedores — ABM autónomo (directorio con filtros).
 * Alta, listado con búsqueda y filtro por rubro, edición, CUIT duplicado,
 * baja lógica y permisos por rol.
 */

describe('Proveedores — API', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await loginAs('admin');
  });

  it('crea un proveedor y aparece en el listado buscándolo por nombre', async () => {
    const business_name = `Proveedor QA ${Date.now()}`;
    const create = await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({
      business_name,
      category: 'Telas',
      contact_person: 'Responsable QA',
      phone: '0351-1234567',
      email: `prov.qa.${Date.now()}@test.local`,
      tax_id: '30-71234567-8',
      tax_condition: 'responsable_inscripto',
    });
    expect(create.status).toBe(201);
    const id = create.body.data?.id;
    expect(id).toBeTruthy();
    // El CUIT se guarda solo con dígitos.
    expect(create.body.data?.tax_id).toBe('30712345678');

    const list = await api()
      .get(`${API}/suppliers?search=${encodeURIComponent(business_name)}`)
      .set(...auth(adminToken));
    expect(list.status).toBe(200);
    const rows = list.body.data ?? [];
    expect(rows.some((s: any) => s.id === id)).toBe(true);
  });

  it('filtra por rubro y expone los rubros en /suppliers/categories', async () => {
    const category = `RubroQA${Date.now().toString().slice(-6)}`;
    await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({
      business_name: `Prov Rubro ${Date.now()}`,
      category,
    });

    const cats = await api().get(`${API}/suppliers/categories`).set(...auth(adminToken));
    expect(cats.status).toBe(200);
    expect(cats.body.data).toContain(category);

    const filtered = await api()
      .get(`${API}/suppliers?category=${encodeURIComponent(category)}`)
      .set(...auth(adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBeGreaterThanOrEqual(1);
    expect(filtered.body.data.every((s: any) => s.category === category)).toBe(true);
  });

  it('rechaza crear un proveedor sin razón social', async () => {
    const res = await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({ category: 'Avíos' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rechaza un CUIT ya usado por otro proveedor', async () => {
    const tax_id = `30-7${Date.now().toString().slice(-7)}-9`;
    const a = await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({
      business_name: `Prov CUIT A ${Date.now()}`, tax_id,
    });
    expect(a.status).toBe(201);
    const b = await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({
      business_name: `Prov CUIT B ${Date.now()}`, tax_id,
    });
    expect(b.status).toBe(409);
  });

  it('edita un proveedor y lo da de baja lógicamente', async () => {
    const create = await api().post(`${API}/suppliers`).set(...auth(adminToken)).send({
      business_name: `Prov Baja ${Date.now()}`,
    });
    const id = create.body.data.id;

    const upd = await api().put(`${API}/suppliers/${id}`).set(...auth(adminToken)).send({
      contact_person: 'Nuevo contacto', payment_terms: '30 días',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.contact_person).toBe('Nuevo contacto');

    const off = await api().patch(`${API}/suppliers/${id}/status`).set(...auth(adminToken)).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);

    // Ya no aparece sin include_inactive; sí con él.
    const hidden = await api().get(`${API}/suppliers?search=${encodeURIComponent('Prov Baja')}`).set(...auth(adminToken));
    expect((hidden.body.data ?? []).some((s: any) => s.id === id)).toBe(false);
    const shown = await api()
      .get(`${API}/suppliers?include_inactive=true&search=${encodeURIComponent('Prov Baja')}`)
      .set(...auth(adminToken));
    expect((shown.body.data ?? []).some((s: any) => s.id === id)).toBe(true);
  });

  it('el vendedor no puede ver ni crear proveedores; solo admin puede borrar', async () => {
    const seller = await loginAs('seller');
    const forbiddenList = await api().get(`${API}/suppliers`).set(...auth(seller));
    expect(forbiddenList.status).toBe(403);
    const forbiddenCreate = await api().post(`${API}/suppliers`).set(...auth(seller)).send({ business_name: 'X' });
    expect(forbiddenCreate.status).toBe(403);

    const billing = await loginAs('billing');
    const created = await api().post(`${API}/suppliers`).set(...auth(billing)).send({
      business_name: `Prov Del ${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const billingDelete = await api().delete(`${API}/suppliers/${id}`).set(...auth(billing));
    expect(billingDelete.status).toBe(403);

    const adminDelete = await api().delete(`${API}/suppliers/${id}`).set(...auth(adminToken));
    expect(adminDelete.status).toBe(200);
  });
});
