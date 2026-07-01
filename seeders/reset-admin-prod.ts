// Reset/creación del usuario admin contra CUALQUIER base apuntada por MYSQL_URL.
//
// Pensado para correr contra PRODUCCIÓN (Railway) de forma SEGURA:
//   - NO ejecuta sequelize.sync() → no toca el esquema de la base.
//   - NO carga el .env local → evita apuntar sin querer a localhost o pisar
//     NODE_ENV. Lee TODO de variables de entorno que pasás vos.
//   - Solo toca la fila del usuario admin (UPDATE si existe, INSERT si no).
//
// Uso (PowerShell), con la URL PÚBLICA de la base en Railway
// (MySQL → Connect → Public Network → MYSQL_PUBLIC_URL):
//
//   $env:MYSQL_URL="mysql://user:pass@HOST.proxy.rlwy.net:PUERTO/railway"
//   $env:ADMIN_EMAIL="diego.olmi@gmail.com"
//   $env:ADMIN_PASSWORD="River2018!"
//   npx ts-node --project tsconfig.seed.json seeders/reset-admin-prod.ts
//
// (Después, por seguridad: Remove-Item Env:\MYSQL_URL, Env:\ADMIN_PASSWORD)

import { Sequelize, QueryTypes } from 'sequelize';
import bcrypt from 'bcryptjs';

async function main() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!url) {
    console.error('❌ Falta MYSQL_URL (URL pública de la base en Railway).');
    process.exit(1);
  }
  if (!email || !password) {
    console.error('❌ Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD.');
    process.exit(1);
  }

  const sequelize = new Sequelize(url, { dialect: 'mysql', logging: false });
  await sequelize.authenticate();
  // Aviso defensivo: si por error apunta a localhost, que se note.
  const host = (() => { try { return new URL(url).host; } catch { return '(desconocido)'; } })();
  console.log(`✅ Conectado a ${host}`);

  const hash = await bcrypt.hash(password, 12);

  const rows = await sequelize.query<{ id: number }>(
    'SELECT id FROM users WHERE email = ?',
    { replacements: [email], type: QueryTypes.SELECT }
  );

  if (rows.length > 0) {
    await sequelize.query(
      'UPDATE users SET password_hash = ?, role = "admin", active = 1, updatedAt = NOW() WHERE email = ?',
      { replacements: [hash, email] }
    );
    console.log(`♻️  Admin ${email}: contraseña actualizada (usuario ya existía).`);
  } else {
    await sequelize.query(
      `INSERT INTO users (name, email, password_hash, role, active, session_version, createdAt, updatedAt)
       VALUES (?, ?, ?, 'admin', 1, 0, NOW(), NOW())`,
      { replacements: ['Administrador', email, hash] }
    );
    console.log(`✅ Admin ${email}: creado (no existía en esta base).`);
  }

  await sequelize.close();
  console.log('🎉 Listo. Probá el login con la nueva contraseña.');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
