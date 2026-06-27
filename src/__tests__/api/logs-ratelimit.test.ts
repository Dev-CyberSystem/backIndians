import { api, API } from './helpers';

/*
 * Ingesta de logs del cliente + rate-limit. Verifica que el endpoint acepta un
 * log (204) y que al superar el umbral por IP responde 429.
 */

describe('Logs del cliente + rate-limit — API', () => {
  it('acepta un log del cliente (204) o ya está limitado (429)', async () => {
    const res = await api().post(`${API}/logs/client`).send({
      level: 'error',
      operationName: 'react.render',
      message: 'Boom en el cliente',
      error: { message: 'x is not a function', type: 'TypeError' },
    });
    expect([204, 429]).toContain(res.status);
  });

  it('aplica rate-limit al superar el umbral (aparece 429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) {
      const res = await api().post(`${API}/logs/client`).send({ level: 'info', operationName: 'ping' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
