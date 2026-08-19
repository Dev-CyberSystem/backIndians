import { api, API, loginAs, auth } from './helpers';
import { User } from '../../models/User';

/*
 * Política de contraseñas del staff (S-02 de la auditoría del 2026-08-19).
 *
 * El regex topeaba en 10 caracteres mientras los compradores de la tienda
 * tenían min 6 / max 100: el administrador que mueve la caja no podía usar una
 * passphrase y el comprador sí. No había razón técnica (bcrypt corta a 72
 * bytes). Ahora es {10,128}.
 *
 * La parte que importa y es fácil de romper sin darse cuenta: el login NO
 * revalida contra el regex. Si alguien "endurece" el login aplicándoselo
 * también, deja afuera a todos los usuarios que hoy tienen 6-10 caracteres —
 * incluidos los sembrados. El último test de este archivo es esa red.
 */

describe('Política de contraseñas del staff — S-02', () => {
  let admin: string;
  const creados: string[] = [];

  beforeAll(async () => {
    admin = await loginAs('admin');
  });

  afterAll(async () => {
    if (creados.length > 0) await User.destroy({ where: { email: creados } });
  });

  async function crearUsuario(password: string) {
    const email = `qa-pwd+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    const res = await api().post(`${API}/users`).set(...auth(admin))
      .send({ name: 'QA Política Contraseñas', email, password, role: 'seller' });
    if (res.status === 201) creados.push(email);
    return { res, email };
  }

  it('rechaza una contraseña de 9 caracteres — el mínimo ahora es 10', async () => {
    const { res } = await crearUsuario('Secreta1!');
    expect(res.status).toBe(422);
  });

  it('acepta una contraseña de exactamente 10 caracteres', async () => {
    const { res } = await crearUsuario('Secreta12!');
    expect(res.status).toBe(201);
  });

  it('acepta una passphrase larga — lo que el tope de 10 impedía', async () => {
    const { res } = await crearUsuario('caballo-correcto-bateria-grapa-2026!');
    expect(res.status).toBe(201);
  });

  it('sigue exigiendo letras, números y un carácter especial', async () => {
    for (const debil of ['sololetrasminusculas', '12345678901234', 'SinEspecial12345']) {
      const { res } = await crearUsuario(debil);
      expect(res.status).toBe(422);
    }
  });

  it('las contraseñas cortas que ya existen siguen sirviendo para entrar', async () => {
    // Los usuarios sembrados tienen contraseñas de 9 caracteres ('Admin123!').
    // Si el login empezara a validar contra PWD_REGEX, quedarían todos afuera:
    // subir el mínimo NO debe expulsar a nadie.
    const res = await api().post(`${API}/auth/login`).send({ email: 'admin@textil.com', password: 'Admin123!' });
    expect(res.status).toBe(200);
  });

  it('el comprador de la tienda conserva su propio mínimo, más bajo (min 6)', async () => {
    // Los dos sistemas de auth son independientes: subir el mínimo del staff no
    // debe arrastrar al de la tienda, donde una barrera alta cuesta ventas.
    const res = await api().post(`${API}/store/auth/register`).send({
      name: 'Robot QA Pwd Tienda',
      email: `qa-pwd-tienda+${Date.now()}@test.local`,
      password: 'Corta1!',
      accept_terms: true,
    });
    expect(res.status).toBe(201);
  });
});
