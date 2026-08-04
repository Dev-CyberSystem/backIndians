import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from '../src/config/db';
import '../src/models/index';
import { User } from '../src/models/User';
import bcrypt from 'bcryptjs';

async function createAdmin() {
  await connectDB();

  const email = process.env.ADMIN_EMAIL || 'admin@indians.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const name = process.env.ADMIN_NAME || 'Administrador';

  const hash = await bcrypt.hash(password, 12);

  const [user, created] = await User.findOrCreate({
    where: { email },
    defaults: { name, email, password_hash: hash, role: 'admin', active: true },
  });

  if (created) {
    console.log(`✅ Admin creado: ${email} / ${password}`);
  } else {
    // findOrCreate no actualiza: refrescamos hash/rol/estado para que la
    // contraseña indicada siempre quede vigente (seed idempotente).
    user.name = name;
    user.password_hash = hash;
    user.role = 'admin';
    user.active = true;
    await user.save();
    console.log(`♻️  El usuario ${email} ya existía: credenciales actualizadas a ${password}`);
  }

  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
