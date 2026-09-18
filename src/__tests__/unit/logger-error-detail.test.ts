import { toErrorDetail } from '../../utils/logger';

/**
 * Regresión: los errores que reporta el frontend por POST /logs/client viajan
 * como objeto plano (JSON no transporta instancias de Error). `toErrorDetail`
 * sólo contemplaba `instanceof Error`, así que el resto caía en `String(error)`
 * y el log de producción quedaba en "[object Object]", perdiendo el mensaje
 * real. Un error del cliente ilegible es un error que no existe.
 */
describe('toErrorDetail', () => {
  it('conserva mensaje y tipo de un Error real', () => {
    const detail = toErrorDetail(new TypeError('algo explotó'));
    expect(detail.message).toBe('algo explotó');
    expect(detail.type).toBe('TypeError');
  });

  it('normaliza el error serializado que manda el cliente', () => {
    const detail = toErrorDetail({
      message: 'Request failed with status code 500',
      type: 'AxiosError',
      stack: 'AxiosError: ...',
    });
    expect(detail.message).toBe('Request failed with status code 500');
    expect(detail.type).toBe('AxiosError');
    expect(detail.message).not.toBe('[object Object]');
  });

  it('usa `name` cuando el objeto no trae `type`', () => {
    const detail = toErrorDetail({ message: 'sin red', name: 'NetworkError' });
    expect(detail.type).toBe('NetworkError');
  });

  it('serializa un objeto sin forma de error en vez de perderlo', () => {
    const detail = toErrorDetail({ status: 401, detalle: 'cloud_name deshabilitado' });
    expect(detail.message).not.toBe('[object Object]');
    expect(detail.message).toContain('cloud_name deshabilitado');
    expect(detail.type).toBe('UnknownError');
  });

  it('no rompe ante referencias circulares', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => toErrorDetail(circular)).not.toThrow();
  });

  it('sigue manejando primitivos', () => {
    expect(toErrorDetail('falló feo').message).toBe('falló feo');
    expect(toErrorDetail(null).message).toBe('null');
  });
});
