/**
 * Opciones para express-validator `.normalizeEmail(EMAIL_NORMALIZE_OPTS)`.
 *
 * Por defecto, `normalizeEmail()` para direcciones @gmail.com ELIMINA los puntos
 * del nombre (gmail_remove_dots) y el sub-address `+etiqueta`. Eso rompe el
 * lookup/almacenamiento cuando el email guardado tiene puntos: p. ej.
 * "diego.olmi@gmail.com" se normaliza a "diegoolmi@gmail.com" y deja de coincidir
 * con el registro real → el login o el forgot-password no encuentran al usuario.
 *
 * Desactivamos esas dos transformaciones para que el email normalizado coincida
 * con lo que la persona escribe y con lo que está guardado. Se mantiene el
 * lowercasing del dominio (comportamiento por defecto seguro).
 *
 * IMPORTANTE: usar SIEMPRE estas mismas opciones en TODOS los `.normalizeEmail()`
 * del proyecto para que guardado y búsqueda queden consistentes.
 */
export const EMAIL_NORMALIZE_OPTS = {
  gmail_remove_dots: false,
  gmail_remove_subaddress: false,
} as const;
