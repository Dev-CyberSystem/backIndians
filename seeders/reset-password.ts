import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';

/**
 * Genera un nuevo password_hash (bcrypt, cost 12 — mismo que usa el sistema).
 *
 * Uso:
 *   # Solo generar el hash e imprimirlo (no toca la base de datos):
 *   npx ts-node --project tsconfig.seed.json seeders/reset-password.ts --password "NuevaClave1"
 *
 *   # Generar el hash Y actualizar al usuario en la base de datos:
 *   npx ts-node --project tsconfig.seed.json seeders/reset-password.ts --email "user@indians.com" --password "NuevaClave1"
 *
 * Notas:
 *   - Si no pasás --password, se toma de la variable de entorno NEW_PASSWORD.
 *   - La contraseña se valida con la misma regla del sistema (6-10 caracteres,
 *     letras + números + un carácter especial). Usá --force para saltearla.
 *   - Al actualizar por --email se incrementa session_version (si existe),
 *     invalidando los tokens/sesiones anteriores de ese usuario.
 */

// Misma regla que aplica el backend al crear/editar usuarios del sistema
// (ver src/routes/user.routes.ts): 6-10 caracteres, con letras, números y al
// menos un carácter especial. Mantener sincronizado con esa fuente.
const PWD_REGEX =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]])[A-Za-z\d@$!%*#?&._\-+\/:;,()=~|<>{}^\[\]]{6,10}$/;
const PWD_MSG =
  'La contraseña debe tener entre 6 y 10 caracteres, incluir letras, números y al menos un carácter especial (@ $ ! % * # ? & . _ - + / etc.)';

// ── Parseo simple de argumentos --clave valor ──────────────────────────────
function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const password = getArg('password') ?? process.env.NEW_PASSWORD;
  const email = getArg('email');
  const skipValidation = process.argv.includes('--force');

  if (!password) {
    console.error(
      '❌ Falta la contraseña. Usá --password "TuClave" (o la env NEW_PASSWORD).'
    );
    process.exit(1);
  }

  if (!skipValidation && !PWD_REGEX.test(password)) {
    console.error(`❌ Contraseña inválida. ${PWD_MSG}`);
    console.error(
      '   Si necesitás forzar un hash de todos modos, agregá --force.'
    );
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  console.log('\n🔑 password_hash generado:');
  console.log(hash + '\n');

  // Si no se indicó email, solo imprimimos el hash y salimos (sin tocar la DB).
  if (!email) {
    console.log(
      'ℹ️  No se indicó --email: no se modificó ningún usuario.\n' +
        '   Para actualizar en la base directamente podés correr, por ejemplo:\n' +
        `   UPDATE users SET password_hash = '${hash}' WHERE email = 'tu@email.com';\n`
    );
    process.exit(0);
  }

  // Modo actualizar: conectar a la DB y guardar el nuevo hash.
  const { connectDB } = await import('../src/config/db');
  await import('../src/models/index');
  const { User } = await import('../src/models/User');

  await connectDB();

  const user = await User.findOne({ where: { email } });
  if (!user) {
    console.error(`❌ No se encontró ningún usuario con email: ${email}`);
    process.exit(1);
  }

  const updates: Record<string, unknown> = { password_hash: hash };
  // Invalidar sesiones anteriores si el modelo lo soporta.
  if ('session_version' in user) {
    updates.session_version = ((user as any).session_version ?? 0) + 1;
  }

  await user.update(updates);

  console.log(`✅ Contraseña actualizada para: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
