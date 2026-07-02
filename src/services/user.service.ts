import crypto from 'crypto';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import {
  User,
  Order,
  Invoice,
  CatalogOrder,
  StockMovement,
  CashTransaction,
  OrderStatusHistory,
  PasswordResetToken,
} from '../models';
import { AppError } from '../middlewares/errorHandler';
import { UserRole } from '../types';
import { sendMail, buildWelcomeEmail } from '../utils/mailer';
import { logger } from '../utils/logger';

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

/** Resultado del envío del mail de bienvenida, para informar a la UI. */
export interface WelcomeEmailStatus {
  sent: boolean;
  error?: string;
}

/** Vista pública del usuario (sin el hash de la contraseña). */
type SafeUser = Omit<User, 'password_hash'>;

const SYSTEM_LOGIN_URL = () => {
  const base =
    process.env.SYSTEM_URL ||
    process.env.FRONTEND_URL?.split(',')[0].trim() ||
    'http://localhost:5173';
  return `${base}/login`;
};

/**
 * Genera una contraseña temporal válida para el regex de la ruta
 * (6-10 caracteres, con al menos una letra, un dígito y un carácter especial).
 * Se usa al reenviar el mail cuando ya no se conoce la contraseña original.
 */
function generateTempPassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const specials = '@$!%*#?&';
  const pick = (set: string) => set[crypto.randomInt(set.length)];

  const chars = [
    pick(letters), pick(letters), pick(letters), pick(letters), pick(letters),
    pick(digits),
    pick(specials),
  ];
  // Mezcla Fisher-Yates para que la posición del dígito/especial no sea fija.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Envía el mail de bienvenida y persiste el resultado en el usuario
 * (`welcome_email_sent_at` / `welcome_email_error`). Nunca lanza: devuelve el
 * estado para que el caller lo informe. Un fallo queda logueado con su motivo.
 */
async function deliverWelcomeEmail(user: User, password: string): Promise<WelcomeEmailStatus> {
  try {
    await sendMail({
      to: user.email,
      subject: 'Tu cuenta en el sistema Indians',
      html: buildWelcomeEmail({
        name: user.name,
        email: user.email,
        role: user.role,
        password,
        loginUrl: SYSTEM_LOGIN_URL(),
      }),
    });
    await user.update({ welcome_email_sent_at: new Date(), welcome_email_error: null });
    logger.info('user.welcomeEmail.sent', { meta: { userId: user.id, email: user.email } });
    return { sent: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Mensaje claro y acotado al tamaño de la columna.
    const reason = error.message.slice(0, 500);
    await user.update({ welcome_email_sent_at: null, welcome_email_error: reason });
    logger.error('user.welcomeEmail', error, { meta: { userId: user.id, email: user.email } });
    return { sent: false, error: reason };
  }
}

/** Re-lee el usuario sin el hash de contraseña. */
async function findSafeUser(id: number): Promise<SafeUser> {
  const safe = await User.findByPk(id, { attributes: { exclude: ['password_hash'] } });
  return safe! as unknown as SafeUser;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
}

export async function listUsers() {
  return User.findAll({
    attributes: { exclude: ['password_hash'] },
    order: [['name', 'ASC']],
  });
}

export async function createUser(
  input: CreateUserInput
): Promise<{ user: SafeUser; welcomeEmail: WelcomeEmailStatus }> {
  const existing = await User.findOne({ where: { email: input.email } });
  if (existing) throw new AppError('El email ya está en uso', 409);

  const password_hash = await bcrypt.hash(input.password, 12);

  const user = await User.create({
    name: input.name,
    email: input.email,
    password_hash,
    role: input.role,
    active: true,
  });

  // Aviso de bienvenida con los datos de acceso. Se espera el resultado para
  // poder confirmarlo en la respuesta, pero un fallo NO revierte la creación:
  // deliverWelcomeEmail nunca lanza y deja el motivo persistido + logueado.
  const welcomeEmail = await deliverWelcomeEmail(user, input.password);

  return { user: await findSafeUser(user.id), welcomeEmail };
}

/**
 * Reenvía el mail de bienvenida a un usuario (típicamente tras un fallo de
 * envío). Como la contraseña original ya no es recuperable (está hasheada), se
 * genera una contraseña temporal nueva, se actualiza la cuenta y se envía en el
 * mail con la recomendación de cambiarla.
 */
export async function resendWelcomeEmail(
  id: number
): Promise<{ user: SafeUser; welcomeEmail: WelcomeEmailStatus }> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const tempPassword = generateTempPassword();
  await user.update({ password_hash: await bcrypt.hash(tempPassword, 12) });

  const welcomeEmail = await deliverWelcomeEmail(user, tempPassword);
  if (!welcomeEmail.sent) {
    throw new AppError(
      `No se pudo reenviar el mail: ${welcomeEmail.error ?? 'error desconocido'}`,
      502
    );
  }

  return { user: await findSafeUser(user.id), welcomeEmail };
}

export async function updateUser(
  id: number,
  input: UpdateUserInput
): Promise<User> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const updateData: Partial<User> = {};

  if (input.name !== undefined) updateData.name = input.name;
  if (input.email !== undefined) {
    const existing = await User.findOne({ where: { email: input.email } });
    if (existing && existing.id !== id) throw new AppError('El email ya está en uso', 409);
    updateData.email = input.email;
  }
  if (input.role !== undefined) updateData.role = input.role;
  if (input.active !== undefined) updateData.active = input.active;
  if (input.password) {
    (updateData as any).password_hash = await bcrypt.hash(input.password, 12);
  }

  await user.update(updateData);

  const updated = await User.findByPk(id, {
    attributes: { exclude: ['password_hash'] },
  });
  return updated!;
}

export async function toggleUserActive(id: number, requesterId: number): Promise<User> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  if (id === requesterId) throw new AppError('No podés desactivarte a vos mismo', 400);

  // Si va a quedar inactivo y es admin, verificar que quede al menos un admin activo
  if (user.active && user.role === 'admin') {
    const activeAdmins = await User.count({ where: { role: 'admin', active: true } });
    if (activeAdmins <= 1) throw new AppError('No podés desactivar el único administrador activo', 400);
  }

  await user.update({ active: !user.active });
  const updated = await User.findByPk(id, { attributes: { exclude: ['password_hash'] } });
  return updated!;
}

export async function changeUserPassword(id: number, newPassword: string): Promise<void> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);
  const password_hash = await bcrypt.hash(newPassword, 12);
  await user.update({ password_hash });
}

/**
 * Eliminación DEFINITIVA del usuario (borrado físico de la base). Sin vuelta
 * atrás. Solo procede si el usuario no tiene relaciones operacionales: pedidos,
 * facturas, ventas de catálogo, movimientos de stock, transacciones de caja ni
 * historial de cambios de estado. Si tiene alguna, se bloquea con un mensaje
 * claro (conviene desactivarlo en su lugar).
 */
export async function deleteUser(id: number, requesterId: number): Promise<void> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  if (id === requesterId) throw new AppError('No podés eliminarte a vos mismo', 400);

  // No dejar al sistema sin administradores.
  if (user.role === 'admin') {
    const admins = await User.count({ where: { role: 'admin' } });
    if (admins <= 1) throw new AppError('No podés eliminar el único administrador', 400);
  }

  // Verificación de relaciones. Los pedidos ya implican sus facturas
  // (autogeneradas y en cascada), pero contamos las facturas aparte para el
  // mensaje. Cualquier relación existente bloquea la eliminación.
  const [pedidos, facturas, ventasCatalogo, movimientosStock, transaccionesCaja, historial] =
    await Promise.all([
      Order.count({ where: { [Op.or]: [{ created_by: id }, { seller_id: id }] } }),
      Invoice.count({
        include: [{
          model: Order,
          as: 'order',
          required: true,
          where: { [Op.or]: [{ created_by: id }, { seller_id: id }] },
        }],
      }),
      CatalogOrder.count({ where: { seller_id: id } }),
      StockMovement.count({ where: { user_id: id } }),
      CashTransaction.count({ where: { created_by: id } }),
      OrderStatusHistory.count({ where: { changed_by: id } }),
    ]);

  const blockers: string[] = [];
  if (pedidos > 0) blockers.push(`${pedidos} pedido(s)`);
  if (facturas > 0) blockers.push(`${facturas} factura(s)`);
  if (ventasCatalogo > 0) blockers.push(`${ventasCatalogo} venta(s) de catálogo`);
  if (movimientosStock > 0) blockers.push(`${movimientosStock} movimiento(s) de stock`);
  if (transaccionesCaja > 0) blockers.push(`${transaccionesCaja} transacción(es) de caja`);
  if (historial > 0) blockers.push(`${historial} cambio(s) de estado de pedidos`);

  if (blockers.length > 0) {
    throw new AppError(
      `No se puede eliminar: el usuario tiene ${blockers.join(', ')} asociado(s). ` +
      `Los perfiles con actividad registrada no pueden eliminarse; desactivalo en su lugar.`,
      409
    );
  }

  try {
    // Los tokens de reset de contraseña son metadata descartable (no actividad
    // de negocio): se limpian explícitamente antes de borrar. No confiamos en
    // el ON DELETE CASCADE de la migración porque un `sync({alter:true})` en
    // desarrollo puede dejar la FK real como NO ACTION en la base.
    await PasswordResetToken.destroy({ where: { user_id: id } });
    // Borrado físico.
    await user.destroy();
  } catch (err: any) {
    // Red de seguridad ante alguna relación no contemplada (ej: imágenes de
    // pedidos subidas por el usuario) que la FK impida borrar.
    if (err?.name === 'SequelizeForeignKeyConstraintError') {
      throw new AppError(
        'No se puede eliminar: el usuario tiene registros asociados en el sistema. Desactivalo en su lugar.',
        409
      );
    }
    throw err;
  }
}
