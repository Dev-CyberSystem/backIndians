// Precarga de pruebas: permite que la aplicación lea su configuración habitual,
// pero aborta ANTES de acceder a una base no local. No imprime secretos.
const dotenv = require('dotenv');
const original = dotenv.config;
dotenv.config = function (...args) {
  const result = original.apply(this, args);
  const host = process.env.MYSQL_URL ? new URL(process.env.MYSQL_URL).hostname : (process.env.DB_HOST || 'localhost');
  if (!['localhost','127.0.0.1','::1','[::1]'].includes(host)) throw new Error('Pruebas bloqueadas: la base configurada no es local');
  process.env.NODE_ENV='test';
  return result;
};
process.env.NODE_ENV='test';
process.env.INDIANS_LOCAL_TEST='1';
