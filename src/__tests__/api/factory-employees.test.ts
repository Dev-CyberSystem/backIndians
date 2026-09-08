import { api, API, loginAs, auth } from './helpers';

/*
 * Empleados (legajo) + histórico de novedades. Módulo restringido a `admin`.
 * Alta, filtro por sector, DNI duplicado, cambio de sueldo como novedad (que
 * actualiza la remuneración de la ficha), baja lógica y permisos por rol.
 */

describe('Empleados — API', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await loginAs('admin');
  });

  it('crea un empleado y aparece filtrando por sector + /employees/sectors', async () => {
    const full_name = `Empleado QA ${Date.now()}`;
    const dni = `${Date.now()}`.slice(-8);
    const sector = `SectorQA${Date.now().toString().slice(-5)}`;

    const create = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name,
      dni,
      address: 'Av. Siempreviva 742',
      email: `emp.qa.${Date.now()}@test.local`,
      phone: '0351-1234567',
      hire_date: '2024-03-01',
      current_remuneration: 500000,
      sector,
    });
    expect(create.status).toBe(201);
    const id = create.body.data?.id;
    expect(id).toBeTruthy();
    expect(create.body.data.dni).toBe(dni);
    expect(Number(create.body.data.current_remuneration)).toBe(500000);

    const sectors = await api().get(`${API}/employees/sectors`).set(...auth(adminToken));
    expect(sectors.body.data).toContain(sector);

    const filtered = await api()
      .get(`${API}/employees?sector=${encodeURIComponent(sector)}`)
      .set(...auth(adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.every((e: any) => e.sector === sector)).toBe(true);
    expect(filtered.body.data.some((e: any) => e.id === id)).toBe(true);
  });

  it('rechaza DNI duplicado y DNI inválido', async () => {
    const dni = `${Date.now()}`.slice(-8);
    const a = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: `Emp DNI A ${Date.now()}`, dni, hire_date: '2023-01-10',
    });
    expect(a.status).toBe(201);
    const b = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: `Emp DNI B ${Date.now()}`, dni, hire_date: '2023-01-10',
    });
    expect(b.status).toBe(409);
    const bad = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: 'Emp DNI corto', dni: '123', hire_date: '2023-01-10',
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
  });

  it('una novedad de cambio de sueldo actualiza la remuneración y guarda el anterior', async () => {
    const create = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: `Emp Sueldo ${Date.now()}`,
      dni: `${Date.now()}`.slice(-8),
      hire_date: '2022-06-01',
      current_remuneration: 400000,
    });
    const id = create.body.data.id;

    const ev = await api().post(`${API}/employees/${id}/events`).set(...auth(adminToken)).send({
      type: 'salary_change',
      title: 'Aumento paritaria',
      amount: 480000,
      event_date: '2024-04-01',
    });
    expect(ev.status).toBe(201);
    expect(Number(ev.body.data.amount)).toBe(480000);
    expect(Number(ev.body.data.previous_amount)).toBe(400000);
    expect(ev.body.data.author?.id).toBeTruthy();

    const detail = await api().get(`${API}/employees/${id}`).set(...auth(adminToken));
    expect(Number(detail.body.data.current_remuneration)).toBe(480000);
    expect(detail.body.data.events.length).toBe(1);

    // salary_change sin monto → 400
    const noAmount = await api().post(`${API}/employees/${id}/events`).set(...auth(adminToken)).send({
      type: 'salary_change', title: 'Sin monto',
    });
    expect(noAmount.status).toBeGreaterThanOrEqual(400);
    expect(noAmount.status).toBeLessThan(500);
  });

  it('carga otras novedades y permite borrarlas (admin)', async () => {
    const create = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: `Emp Novedades ${Date.now()}`,
      dni: `${Date.now()}`.slice(-8),
      hire_date: '2021-02-15',
    });
    const id = create.body.data.id;

    for (const type of ['sanction', 'notification', 'sick_leave', 'other']) {
      const r = await api().post(`${API}/employees/${id}/events`).set(...auth(adminToken)).send({
        type, title: `Novedad ${type}`, body: 'Detalle de prueba',
      });
      expect(r.status).toBe(201);
    }
    const list = await api().get(`${API}/employees/${id}/events`).set(...auth(adminToken));
    expect(list.body.data.length).toBe(4);

    const eventId = list.body.data[0].id;
    const del = await api().delete(`${API}/employees/${id}/events/${eventId}`).set(...auth(adminToken));
    expect(del.status).toBe(200);
    const after = await api().get(`${API}/employees/${id}/events`).set(...auth(adminToken));
    expect(after.body.data.length).toBe(3);
  });

  it('da de baja lógica (fecha de egreso) y reactiva', async () => {
    const create = await api().post(`${API}/employees`).set(...auth(adminToken)).send({
      full_name: `Emp Baja ${Date.now()}`,
      dni: `${Date.now()}`.slice(-8),
      hire_date: '2020-01-01',
    });
    const id = create.body.data.id;

    const off = await api().patch(`${API}/employees/${id}/status`).set(...auth(adminToken)).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);
    expect(off.body.data.termination_date).toBeTruthy();

    const hidden = await api().get(`${API}/employees?search=${encodeURIComponent('Emp Baja')}`).set(...auth(adminToken));
    expect((hidden.body.data ?? []).some((e: any) => e.id === id)).toBe(false);

    const on = await api().patch(`${API}/employees/${id}/status`).set(...auth(adminToken)).send({ active: true });
    expect(on.body.data.active).toBe(true);
    expect(on.body.data.termination_date).toBeNull();
  });

  it('billing y seller no acceden al módulo (solo admin)', async () => {
    for (const role of ['billing', 'seller'] as const) {
      const token = await loginAs(role);
      const listRes = await api().get(`${API}/employees`).set(...auth(token));
      expect(listRes.status).toBe(403);
      const createRes = await api().post(`${API}/employees`).set(...auth(token)).send({
        full_name: 'X', dni: '12345678', hire_date: '2024-01-01',
      });
      expect(createRes.status).toBe(403);
    }
  });
});
