import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '@prisma/client';
import { prisma } from './prisma';
import { config } from '../config';
import { ApiError } from './errors';
import { dispatchNotification } from './notifications';

export interface JwtPayload {
  sub: string;
  role: string;
  type: 'access' | 'refresh';
}

export const ACCESS_TTL = '15m';
export const REFRESH_TTL = '7d';

export async function signAccessToken(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role, type: 'access' }, config.jwtAccessSecret, {
    expiresIn: ACCESS_TTL,
  });
}

export async function signRefreshToken(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role, type: 'refresh' }, config.jwtRefreshSecret, {
    expiresIn: REFRESH_TTL,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtAccessSecret) as JwtPayload;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function createRefreshToken(userId: string, role: string) {
  const token = await signRefreshToken({ id: userId, role });
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
  return token;
}

/**
 * Express guard: requires a valid Bearer access token; attaches
 * `req.auth = { userId, role, permissions }`.
 */
export async function requireAuth(req: any, _res: any, next: any) {
  const header: string = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized());
  try {
    const payload = verifyToken(token);
    if (payload.type !== 'access') throw new Error('wrong token type');
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: { include: { perms: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user || !user.isActive) return next(ApiError.unauthorized('Account disabled'));
    const role = user.roles[0]?.role.name ?? 'CUSTOMER';
    const permissions = user.roles.flatMap((ur) =>
      (ur.role.perms as Array<{ permission: { key: string } }>).map((rp) => rp.permission.key),
    );
    req.auth = { userId: user.id, role, permissions, user: pickUser(user) };
    next();
  } catch (e) {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}

/** Optional auth: attaches `req.auth` when a valid Bearer token is provided; ignores missing/invalid tokens. */
export async function optionalAuth(req: any, _res: any, next: any) {
  const header: string = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    if (payload.type === 'access') {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          roles: {
            include: {
              role: { include: { perms: { include: { permission: true } } } },
            },
          },
        },
      });
      if (user && user.isActive) {
        const role = user.roles[0]?.role.name ?? 'CUSTOMER';
        const permissions = user.roles.flatMap((ur) =>
          (ur.role.perms as Array<{ permission: { key: string } }>).map((rp) => rp.permission.key),
        );
        req.auth = { userId: user.id, role, permissions, user: pickUser(user) };
      }
    }
  } catch {
    // Public route ignores invalid tokens gracefully
  }
  next();
}

function pickUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isEmailVerified: u.isEmailVerified,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePasswordStrength(password: string): void {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw ApiError.badRequest(
      'WEAK_PASSWORD',
      'Password must be at least 8 characters and include both letters and numbers',
    );
  }
}

export function isDevOtpPreviewEnabled(target: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const provider = target.includes('@')
    ? process.env.EMAIL_PROVIDER ?? 'console'
    : process.env.SMS_PROVIDER ?? 'console';
  return provider === 'console';
}

export async function revokeAllRefreshTokens(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Require one of the given roles. */
export function requireRole(...roles: string[]) {
  return (req: any, _res: any, next: any) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!roles.includes(req.auth.role))
      return next(ApiError.forbidden(`Requires role ${roles.join(' or ')}`, 'ROLE_FORBIDDEN'));
    next();
  };
}

/** Require any of the given permission keys. */
export function requirePermission(...perms: string[]) {
  return (req: any, _res: any, next: any) => {
    if (!req.auth) return next(ApiError.unauthorized());
    // A "*" permission (SUPER_ADMIN) grants everything; this latent bug
    // (surfaced by the Phase 4 refund route) meant admins were denied on
    // permission-gated endpoints.
    const has =
      req.auth.permissions.includes('*') ||
      req.auth.permissions.some((p: string) => perms.includes(p));
    if (!has)
      return next(
        ApiError.forbidden(`Requires permission: ${perms.join(', ')}`, 'PERMISSION_FORBIDDEN'),
      );
    next();
  };
}

/** Generate + persist a one-time OTP. Sends via Email notification channel or SMS console. */
export async function issueOtp(
  target: string,
  purpose: string,
  opts: { enforceCooldown?: boolean; cooldownMs?: number } = {},
) {
  if (opts.enforceCooldown) {
    const cooldownMs = opts.cooldownMs ?? 45_000;
    const recent = await prisma.otpCode.findFirst({
      where: {
        target,
        purpose,
        consumedAt: null,
        createdAt: { gte: new Date(Date.now() - cooldownMs) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      throw ApiError.unprocessable(
        'Please wait ~45 seconds before requesting another verification code',
        'OTP_COOLDOWN',
      );
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.otpCode.create({
    data: {
      target,
      purpose,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + 10 * 60_000), // 10-minute expiry
      attempts: 0,
    },
  });

  if (target.includes('@')) {
    await dispatchNotification({
      channel: 'EMAIL',
      target,
      template: `AUTH_${purpose}`,
      subject: 'Your BookCourier Verification Code',
      message: `Your BookCourier verification code is ${code}. Valid for 10 minutes.`,
    }).catch((e) => console.warn('[otp-email] dispatch error', e));
    if (isDevOtpPreviewEnabled(target)) {
      console.log(`[OTP:EMAIL:${purpose}] to=${target} code=${code}`);
    }
  } else if (isDevOtpPreviewEnabled(target)) {
    console.log(`[OTP:${purpose}] target=${target} code=${code}`);
  }
  return code;
}

export async function verifyOtp(target: string, purpose: string, code: string) {
  const row = await prisma.otpCode.findFirst({
    where: { target, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw ApiError.unprocessable('No pending OTP for this target', 'OTP_NOT_FOUND');
  if (row.expiresAt < new Date()) throw ApiError.unprocessable('OTP expired', 'OTP_EXPIRED');
  if (row.attempts >= 5) throw ApiError.unprocessable('Too many OTP attempts', 'OTP_LOCKED');
  await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  if (row.codeHash !== hashOtp(code))
    throw ApiError.unprocessable('Invalid OTP', 'OTP_INVALID');
  await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return true;
}

/** Rotate a refresh token: revoke the old one, issue a new one. */
export async function rotateRefreshToken(oldToken: string) {
  const tokenHash = hashToken(oldToken);
  const stored = await prisma.refreshToken.findFirst({ where: { tokenHash, revokedAt: null } });
  if (!stored) throw ApiError.unauthorized('Refresh token revoked');
  if (stored.expiresAt < new Date()) throw ApiError.unauthorized('Refresh token expired');
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw ApiError.unauthorized('User missing');
  const role = user.roles[0]?.role.name ?? 'CUSTOMER';
  const newToken = await createRefreshToken(user.id, role);
  const access = await signAccessToken({ id: user.id, role });
  return { accessToken: access, refreshToken: newToken };
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { bcrypt };
