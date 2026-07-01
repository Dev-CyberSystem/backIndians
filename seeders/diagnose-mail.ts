import dotenv from 'dotenv';
dotenv.config();

import { Resend } from 'resend';

/**
 * Diagnóstico del envío de mails (Resend) y del flujo forgot-password.
 *
 * Uso:
 *   npx ts-node --project tsconfig.seed.json seeders/diagnose-mail.ts --email "user@indians.com"
 *
 * Hace dos cosas:
 *   1. Revisa si ese email corresponde a un usuario activo (causa típica del
 *      "200 sin mail": forgotPasswordService hace return silencioso si no existe).
 *   2. Envía un mail de prueba real por Resend e imprime el ID o el error exacto.
 */

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = getArg('email');
  if (!email) {
    console.error('❌ Falta --email "user@dominio.com".');
    process.exit(1);
  }

  console.log('\n── Config Resend ──────────────────────────────');
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.RESEND_FROM_EMAIL || 'noreply@indians.com.ar';
  console.log('RESEND_API_KEY:', apiKey ? `presente (${apiKey.slice(0, 5)}…)` : '❌ FALTA');
  console.log('FROM:', from);

  // ── 1. ¿Existe el usuario y está activo? ─────────────────────────────────
  console.log('\n── Usuario en la base ─────────────────────────');
  const { connectDB } = await import('../src/config/db');
  await import('../src/models/index');
  const { User } = await import('../src/models/User');
  await connectDB();

  const exact = await User.findOne({ where: { email } });
  const active = await User.findOne({ where: { email, active: true } });

  if (!exact) {
    console.log(`❌ No existe ningún usuario con email exacto "${email}".`);
    console.log('   → forgot-password devuelve 200 SIN enviar mail (por diseño).');
  } else if (!active) {
    console.log(`⚠️  El usuario existe pero está INACTIVO (active=false).`);
    console.log('   → forgot-password devuelve 200 SIN enviar mail (por diseño).');
  } else {
    console.log(`✅ Usuario activo encontrado: ${(exact as any).name} <${email}>`);
    console.log('   → forgot-password SÍ intenta enviar el mail.');
  }

  // ── 2. Envío de prueba real por Resend ───────────────────────────────────
  console.log('\n── Envío de prueba por Resend ─────────────────');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: email,
    subject: 'Prueba de envío — Indians (diagnóstico)',
    html: '<p>Este es un mail de prueba del diagnóstico de Resend. Si lo recibís, el envío funciona.</p>',
  });

  if (error) {
    console.log('❌ Resend devolvió error:');
    console.log('   name:', error.name);
    console.log('   message:', error.message);
    console.log('\n   Causas frecuentes:');
    console.log('   - Dominio del FROM no verificado en Resend.');
    console.log('   - API key restringida o de otro entorno.');
  } else {
    console.log('✅ Resend aceptó el envío. Email ID:', data?.id);
    console.log('   → Si no llega: revisá spam y el panel de Resend (Logs) con ese ID.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
