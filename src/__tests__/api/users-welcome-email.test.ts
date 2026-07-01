import { api, API, loginAdmin } from './helpers';

/*
 * Mail de bienvenida al crear un usuario del sistema.
 *
 * Mockeamos solo `sendMail` (el envío real por Resend) y dejamos intacto
 * `buildWelcomeEmail` con `requireActual`, de modo de poder inspeccionar el HTML
 * real que arma el servicio. La parte de integración requiere el seed del admin
 * (npm run seed:admin) y MySQL migrado, igual que el resto de los tests de API.
 */
jest.mock('../../utils/mailer', () => {
  const actual = jest.requireActual('../../utils/mailer');
  return { ...actual, sendMail: jest.fn().mockResolvedValue(undefined) };
});

import { sendMail, buildWelcomeEmail } from '../../utils/mailer';
import { Order, OrderStatusHistory } from '../../models';

describe('buildWelcomeEmail — plantilla', () => {
  const html = buildWelcomeEmail({
    name: 'Ada Lovelace',
    email: 'ada@indians.com',
    role: 'billing',
    password: 'Secreta1!',
    loginUrl: 'https://sistema.indians.com.ar/login',
  });

  it('incluye el nombre, email y la contraseña', () => {
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('ada@indians.com');
    expect(html).toContain('Secreta1!');
  });

  it('traduce el rol a su etiqueta amigable', () => {
    expect(html).toContain('Facturación');
    expect(html).not.toContain('>billing<');
  });

  it('incluye el link de ingreso y la recomendación de cambiar la contraseña', () => {
    expect(html).toContain('https://sistema.indians.com.ar/login');
    expect(html).toMatch(/cambiar tu contraseña/i);
  });

  it('escapa HTML en los datos del usuario (anti-inyección)', () => {
    const evil = buildWelcomeEmail({
      name: '<script>alert(1)</script>',
      email: 'x@y.com',
      role: 'seller',
      password: 'Secreta1!',
      loginUrl: 'https://x/login',
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('POST /users — dispara el mail de bienvenida', () => {
  let token: string;
  let createdId: number | undefined;
  const email = `qa.welcome.${Date.now()}@indians.com`;

  beforeAll(async () => {
    token = await loginAdmin();
  });

  afterAll(async () => {
    // Soft delete del usuario de prueba (queda inactivo).
    if (createdId != null) {
      await api().delete(`${API}/users/${createdId}`).set('Authorization', `Bearer ${token}`);
    }
  });

  it('al crear un usuario responde 201, envía el mail y confirma el envío', async () => {
    (sendMail as jest.Mock).mockClear();
    (sendMail as jest.Mock).mockResolvedValueOnce(undefined);

    const res = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'QA Bienvenida', email, password: 'Secreta1!', role: 'seller' });

    expect(res.status).toBe(201);
    createdId = res.body?.data?.id;

    // Confirmación del envío en la respuesta + estado persistido.
    expect(res.body.data.welcomeEmail).toEqual({ sent: true });
    expect(res.body.data.welcome_email_sent_at).toBeTruthy();
    expect(res.body.data.welcome_email_error).toBeNull();

    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = (sendMail as jest.Mock).mock.calls[0][0];
    expect(arg.to).toBe(email);
    expect(arg.subject).toMatch(/cuenta/i);
    expect(arg.html).toContain('QA Bienvenida');
    expect(arg.html).toContain('Secreta1!');
    expect(arg.html).toContain('Vendedor'); // etiqueta de 'seller'
  });

  it('un fallo en el envío no rompe la creación y deja el motivo persistido', async () => {
    (sendMail as jest.Mock).mockRejectedValueOnce(new Error('Resend: rate_limit_exceeded — demasiados envíos'));
    const email2 = `qa.welcome.fail.${Date.now()}@indians.com`;

    const res = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'QA Falla Mail', email: email2, password: 'Secreta1!', role: 'workshop' });

    expect(res.status).toBe(201);
    // El usuario se crea igual, pero se informa y persiste el fallo con su motivo.
    expect(res.body.data.welcomeEmail.sent).toBe(false);
    expect(res.body.data.welcomeEmail.error).toMatch(/rate_limit_exceeded/);
    expect(res.body.data.welcome_email_sent_at).toBeNull();
    expect(res.body.data.welcome_email_error).toMatch(/rate_limit_exceeded/);

    const id = res.body?.data?.id;
    if (id != null) {
      await api().delete(`${API}/users/${id}`).set('Authorization', `Bearer ${token}`);
    }
  });

  it('reenvía el mail de bienvenida con una nueva contraseña temporal', async () => {
    // 1) Creamos un usuario cuyo primer envío falla.
    (sendMail as jest.Mock).mockRejectedValueOnce(new Error('Resend caído'));
    const email3 = `qa.welcome.resend.${Date.now()}@indians.com`;
    const created = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'QA Reenvío', email: email3, password: 'Secreta1!', role: 'billing' });
    expect(created.status).toBe(201);
    expect(created.body.data.welcomeEmail.sent).toBe(false);
    const id = created.body.data.id as number;

    // 2) Reenviamos: ahora el envío funciona.
    (sendMail as jest.Mock).mockClear();
    (sendMail as jest.Mock).mockResolvedValueOnce(undefined);
    const resend = await api()
      .post(`${API}/users/${id}/resend-welcome`)
      .set('Authorization', `Bearer ${token}`);

    expect(resend.status).toBe(200);
    expect(resend.body.data.welcomeEmail).toEqual({ sent: true });
    expect(resend.body.data.welcome_email_sent_at).toBeTruthy();
    expect(resend.body.data.welcome_email_error).toBeNull();

    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = (sendMail as jest.Mock).mock.calls[0][0];
    expect(arg.to).toBe(email3);
    // El mail lleva una contraseña temporal (distinta de la original).
    expect(arg.html).not.toContain('Secreta1!');
    expect(arg.html).toContain('Facturación'); // etiqueta de 'billing'

    await api().delete(`${API}/users/${id}`).set('Authorization', `Bearer ${token}`);
  });

  it('reenviar a un usuario inexistente devuelve 404', async () => {
    const res = await api()
      .post(`${API}/users/99999999/resend-welcome`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /users — eliminación definitiva con verificación de relaciones', () => {
  let token: string;
  let adminId: number;

  beforeAll(async () => {
    token = await loginAdmin();
    const me = await api().get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    adminId = me.body.data.id;
  });

  const createUser = async (role: string) => {
    const email = `qa.del.${role}.${Date.now()}@indians.com`;
    const res = await api()
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'QA Borrar', email, password: 'Secreta1!', role });
    return res.body.data.id as number;
  };

  it('elimina de la base un usuario sin relaciones (desaparece del listado)', async () => {
    const id = await createUser('seller');

    const del = await api().delete(`${API}/users/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await api().get(`${API}/users`).set('Authorization', `Bearer ${token}`);
    const ids = (list.body.data ?? []).map((u: any) => u.id);
    expect(ids).not.toContain(id);
  });

  it('bloquea (409) la eliminación de un usuario con actividad registrada', async () => {
    const order = await Order.findOne();
    if (!order) return; // sin pedidos sembrados no se puede montar la relación

    const id = await createUser('workshop');
    // Relación bloqueante: un cambio de estado hecho por este usuario.
    const hist = await OrderStatusHistory.create({
      order_id: order.id,
      new_status: 'pending',
      changed_by: id,
    });

    const del = await api().delete(`${API}/users/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/no se puede eliminar/i);
    expect(del.body.message).toMatch(/cambio\(s\) de estado/i);

    // Quitada la relación, ahora sí se elimina.
    await hist.destroy();
    const del2 = await api().delete(`${API}/users/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del2.status).toBe(200);
  });

  it('no permite eliminarse a sí mismo (400)', async () => {
    const del = await api().delete(`${API}/users/${adminId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(400);
  });

  it('eliminar un usuario inexistente devuelve 404', async () => {
    const del = await api().delete(`${API}/users/99999999`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(404);
  });
});
