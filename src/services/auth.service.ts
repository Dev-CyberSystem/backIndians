import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { User, PasswordResetToken } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { JwtPayload, UserRole } from '../types';
import { sendMail, buildPasswordResetEmail } from '../utils/mailer';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Genera un access token (corta duración) y un refresh token (larga duración)
function generateTokens(payload: JwtPayload): TokenPair {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] }
  );

  return { accessToken, refreshToken };
}

export async function loginService(
  email: string,
  password: string
): Promise<{ user: Partial<User>; tokens: TokenPair }> {
  const user = await User.findOne({ where: { email, active: true } });

  if (!user) throw new AppError('Credenciales inválidas', 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Credenciales inválidas', 401);

  const payload: JwtPayload = {
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
  };

  const tokens = generateTokens(payload);

  // No devolver el hash de contraseña
  const { password_hash: _, ...safeUser } = user.toJSON();
  return { user: safeUser, tokens };
}

export async function refreshTokenService(
  refreshToken: string
): Promise<TokenPair> {
  let payload: JwtPayload;

  try {
    payload = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as JwtPayload;
  } catch {
    throw new AppError('Refresh token inválido o expirado', 401);
  }

  // Verificar que el usuario sigue activo
  const user = await User.findOne({
    where: { id: payload.id, active: true },
  });
  if (!user) throw new AppError('Usuario no encontrado o inactivo', 401);

  return generateTokens({
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
  });
}

export async function getMeService(userId: number): Promise<Partial<User>> {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
  });
  if (!user) throw new AppError('Usuario no encontrado', 404);
  return user;
}

// Genera token de recuperación y envía el email.
// Siempre responde OK para no revelar si el email existe en el sistema.
export async function forgotPasswordService(email: string): Promise<void> {
  const user = await User.findOne({ where: { email, active: true } });

  if (!user) return; // No revelar si el email existe

  // Invalidar tokens anteriores del mismo usuario que aún no se usaron
  await PasswordResetToken.update(
    { used: true },
    { where: { user_id: user.id, used: false } }
  );

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 hora

  await PasswordResetToken.create({
    user_id: user.id,
    token,
    expires_at: expiresAt,
    used: false,
  });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  await sendMail({
    to: user.email,
    subject: 'Recuperación de contraseña — Sistema Textil',
    html: buildPasswordResetEmail(resetUrl),
  });
}

export async function resetPasswordService(
  token: string,
  newPassword: string
): Promise<void> {
  const resetToken = await PasswordResetToken.findOne({
    where: {
      token,
      used: false,
      expires_at: { [Op.gt]: new Date() },
    },
    include: [{ model: User, as: 'user' }],
  });

  if (!resetToken) {
    throw new AppError('Token inválido o expirado', 400);
  }

  const user = await User.findByPk(resetToken.user_id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const password_hash = await bcrypt.hash(newPassword, 12);

  await user.update({ password_hash });
  await resetToken.update({ used: true });
}
