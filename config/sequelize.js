require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'textil_db',
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    dialect:  'mysql',
    charset:  'utf8mb4',
  },
  test: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'textil_db',
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    dialect:  'mysql',
  },
  production: {
    // MYSQL_PUBLIC_URL funciona local y en Railway; MYSQL_URL solo dentro de Railway
    url:     process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL,
    dialect: 'mysql',
    dialectOptions: { charset: 'utf8mb4' },
  },
};
