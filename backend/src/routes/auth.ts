import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  requireAuth,
  signAccessToken,
  createRefreshToken,
  issueOtp,
  verifyOtp,
  rotateRefreshToken,
  logout,
  normalizeEmail,
  validatePasswordStrength,
  revokeAllRefreshTokens,
  isDevOtpPreviewEnabled,
} from '../lib/auth';
import { ok, handler, ApiError } from '../lib/errors';

export const authRouter = Router();

/** Helper: issue JWT access+refresh tokens and write audit log cleanly. */
async function buildSessionResponse(userId: string, action: string, auditAfter?: Record<string, unknown>) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw ApiError.notFound('User');
  if (!user.isActive) throw ApiError.unauthorized('Account disabled');

  const role = user.roles[0]?.role.name ?? 'CUSTOMER';
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ id: user.id, role }),
    createRefreshToken(user.id, role),
  ]);

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action,
      entity: 'User',
      entityId: user.id,
      ...(auditAfter ? { after: auditAfter as Prisma.InputJsonValue } : {}),
    },
  });

  return {
    accessToken,
    refreshToken,
    role,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      isEmailVerified: user.isEmailVerified,
    },
  };
}

// --- Register a customer directly (legacy endpoint, supports phone/email + optional password). ---
const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1),
  password: z.string().min(6).optional(),
});

authRouter.post(
  '/register',
  handler(async (req, res) => {
    const b = registerSchema.parse(req.body);
    const cleanEmail = b.email ? normalizeEmail(b.email) : null;
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: b.phone.trim() },
          ...(cleanEmail ? [{ email: cleanEmail }] : []),
        ],
      },
    });
    if (existing) throw ApiError.badRequest('DUPLICATE', 'A user with this phone or email already exists');
    const passwordHash = b.password ? await bcrypt.hash(b.password, 10) : null;
    const user = await prisma.user.create({
      data: {
        name: b.name.trim(),
        email: cleanEmail,
        phone: b.phone.trim(),
        passwordHash,
      },
    });
    const custRole = await prisma.role.findUnique({ where: { name: 'CUSTOMER' } });
    if (custRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: custRole.id } },
        update: {},
        create: { userId: user.id, roleId: custRole.id },
      });
    }
    await prisma.customer.create({ data: { userId: user.id, type: 'INDIVIDUAL' } });
    res.status(201).json(ok({ userId: user.id }));
  }),
);

// --- Email-verified Sign Up (Step 1: Send 6-digit Email OTP) ---
const registerSendOtpSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Valid email address is required'),
  phone: z.string().trim().min(5).optional().or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().optional(),
});

authRouter.post(
  '/register/send-otp',
  handler(async (req, res) => {
    const b = registerSendOtpSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    const cleanPhone = b.phone ? b.phone.trim() : null;

    if (b.confirmPassword !== undefined && b.password !== b.confirmPassword) {
      throw ApiError.badRequest('PASSWORD_MISMATCH', 'Password and confirmation do not match');
    }
    validatePasswordStrength(b.password);

    const existingEmail = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingEmail) {
      throw ApiError.badRequest('DUPLICATE_EMAIL', 'An account with this email already exists. Please sign in.');
    }
    if (cleanPhone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone: cleanPhone } });
      if (existingPhone) {
        throw ApiError.badRequest('DUPLICATE_PHONE', 'An account with this phone number already exists.');
      }
    }

    const code = await issueOtp(cleanEmail, 'REGISTER_EMAIL', { enforceCooldown: true });
    res.json(
      ok({
        sent: true,
        email: cleanEmail,
        ...(isDevOtpPreviewEnabled(cleanEmail) ? { devCode: code } : {}),
      }),
    );
  }),
);

// --- Email-verified Sign Up (Step 2: Verify OTP & Create Customer Account) ---
const registerVerifySchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().email(),
  phone: z.string().trim().min(5).optional().or(z.literal('')),
  password: z.string().min(8),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
});

authRouter.post(
  '/register/verify',
  handler(async (req, res) => {
    const b = registerVerifySchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    const cleanPhone = b.phone ? b.phone.trim() : null;

    validatePasswordStrength(b.password);
    await verifyOtp(cleanEmail, 'REGISTER_EMAIL', b.code);

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, ...(cleanPhone ? [{ phone: cleanPhone }] : [])],
      },
    });
    if (existing) {
      throw ApiError.badRequest('DUPLICATE', 'An account with this email or phone already exists.');
    }

    const passwordHash = await bcrypt.hash(b.password, 10);
    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: b.name.trim(),
          email: cleanEmail,
          phone: cleanPhone,
          passwordHash,
          isEmailVerified: true,
        },
      });
      const custRole = await tx.role.findUnique({ where: { name: 'CUSTOMER' } });
      if (custRole) {
        await tx.userRole.create({ data: { userId: user.id, roleId: custRole.id } });
      }
      await tx.customer.create({ data: { userId: user.id, type: 'INDIVIDUAL' } });
      return user;
    });

    const session = await buildSessionResponse(createdUser.id, 'auth.register_email_verified', {
      email: cleanEmail,
    });
    res.status(201).json(ok(session));
  }),
);

// --- Email OTP Sign In (Send & Verify) ---
const emailOtpSendSchema = z.object({
  email: z.string().email('Valid email address is required'),
  purpose: z.enum(['LOGIN_EMAIL', 'PASSWORD_RESET']).default('LOGIN_EMAIL'),
});

authRouter.post(
  '/email-otp/send',
  handler(async (req, res) => {
    const b = emailOtpSendSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      throw ApiError.notFound('Account for this email (please sign up first)');
    }
    if (!user.isActive) {
      throw ApiError.unauthorized('Account disabled');
    }

    const code = await issueOtp(cleanEmail, b.purpose, { enforceCooldown: true });
    res.json(
      ok({
        sent: true,
        email: cleanEmail,
        ...(isDevOtpPreviewEnabled(cleanEmail) ? { devCode: code } : {}),
      }),
    );
  }),
);

const emailOtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
});

authRouter.post(
  '/email-otp/verify',
  handler(async (req, res) => {
    const b = emailOtpVerifySchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    await verifyOtp(cleanEmail, 'LOGIN_EMAIL', b.code);

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) throw ApiError.notFound('Account');
    if (!user.isActive) throw ApiError.unauthorized('Account disabled');

    if (!user.isEmailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } });
    }

    const session = await buildSessionResponse(user.id, 'auth.email_otp_login', { email: cleanEmail });
    res.json(ok(session));
  }),
);

// --- Forgot Password / Reset Password via Email OTP ---
const forgotSchema = z.object({ email: z.string().email('Valid email address is required') });

authRouter.post(
  '/forgot-password',
  handler(async (req, res) => {
    const b = forgotSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    let devCode: string | undefined;
    if (user && user.isActive) {
      const issued = await issueOtp(cleanEmail, 'PASSWORD_RESET', { enforceCooldown: true });
      if (isDevOtpPreviewEnabled(cleanEmail)) {
        devCode = issued;
      }
    }

    res.json(
      ok({
        sent: true,
        message: 'If an active account exists for this email, we sent a 6-digit password reset code.',
        ...(devCode ? { devCode } : {}),
      }),
    );
  }),
);

const resetPasswordSchema = z.object({
  email: z.string().email('Valid email address is required'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().optional(),
});

authRouter.post(
  '/reset-password',
  handler(async (req, res) => {
    const b = resetPasswordSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);

    if (b.confirmPassword !== undefined && b.newPassword !== b.confirmPassword) {
      throw ApiError.badRequest('PASSWORD_MISMATCH', 'Passwords do not match');
    }
    validatePasswordStrength(b.newPassword);

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) throw ApiError.unprocessable('Invalid or expired verification code', 'OTP_INVALID');
    if (!user.isActive) throw ApiError.unauthorized('Account disabled');

    await verifyOtp(cleanEmail, 'PASSWORD_RESET', b.code);

    const passwordHash = await bcrypt.hash(b.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, isEmailVerified: true },
    });
    await revokeAllRefreshTokens(user.id);

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'auth.password_reset',
        entity: 'User',
        entityId: user.id,
      },
    });

    res.json(ok({ reset: true }));
  }),
);

// --- Request an OTP (Phone SMS OTP login, preserved for field/phone accounts). ---
const otpReq = z.object({ target: z.string().min(5), purpose: z.enum(['LOGIN', 'REGISTER']) });

authRouter.post(
  '/request-otp',
  handler(async (req, res) => {
    const b = otpReq.parse(req.body);
    const code = await issueOtp(b.target.trim(), b.purpose);
    res.json(
      ok({
        delivered: (process.env.SMS_PROVIDER ?? 'console') === 'console',
        ...(isDevOtpPreviewEnabled(b.target.trim()) ? { devCode: code } : {}),
      }),
    );
  }),
);

authRouter.post(
  '/verify-otp',
  handler(async (req, res) => {
    const { target, code } = req.body as { target: string; code: string };
    await verifyOtp(target.trim(), 'LOGIN', code);
    const user = await prisma.user.findFirst({
      where: {
        phone: target.trim(),
        OR: [{ customer: { isNot: null } }, { agent: { isNot: null } }, { roles: { some: {} } }],
      },
    });
    if (!user) throw ApiError.notFound('Account (Customer or Agent)');
    if (!user.isActive) throw ApiError.unauthorized('Account disabled');
    const session = await buildSessionResponse(user.id, 'auth.otp_login');
    res.json(ok(session));
  }),
);

// --- Password login (Unified: Customer, Employee, & Super Admin). ---
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  handler(async (req, res) => {
    const b = loginSchema.parse(req.body);
    const cleanEmail = normalizeEmail(b.email);
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) throw ApiError.unauthorized('Invalid email or password');
    if (!user.isActive) throw ApiError.unauthorized('Account disabled');
    if (!user.passwordHash) {
      throw ApiError.unauthorized(
        'No password set for this account yet. Use Email OTP sign in or Forgot Password.',
      );
    }
    const match = await bcrypt.compare(b.password, user.passwordHash);
    if (!match) throw ApiError.unauthorized('Invalid email or password');
    const session = await buildSessionResponse(user.id, 'auth.login', { email: cleanEmail });
    res.json(ok(session));
  }),
);

// --- Refresh rotation. ---
authRouter.post(
  '/refresh',
  handler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const result = await rotateRefreshToken(refreshToken);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) await logout(refreshToken);
    res.json(ok({ loggedOut: true }));
  }),
);

// --- Me. ---
authRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    res.json(ok({ user: req.auth.user, role: req.auth.role, permissions: req.auth.permissions }));
  }),
);
