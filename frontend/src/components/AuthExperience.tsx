'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  Phone,
  User as UserIcon,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  staffLogin,
  sendEmailOtp,
  verifyEmailOtp,
  sendSignupOtp,
  verifySignupOtp,
  requestOtp,
  verifyOtp,
  forgotPasswordApi,
  resetPasswordApi,
  getMe,
  AuthLoginResult,
} from '@/lib/api';
import { getToken, setToken, clearToken } from '@/lib/auth';
import { defaultHomeForRole, getRoleCapabilities } from '@/lib/rbac';
import { PasswordInput } from '@/components/PasswordInput';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

const IS_DEV = process.env.NODE_ENV !== 'production';

function resolvePostAuthRoute(role: string, requestedRedirect: string | null): string {
  const caps = getRoleCapabilities(role);
  if (!requestedRedirect || !requestedRedirect.startsWith('/') || requestedRedirect.startsWith('//')) {
    return caps.defaultHome;
  }
  const base = requestedRedirect.split('?')[0];
  if (base.startsWith('/admin') && !caps.canViewAdminConsole) return caps.defaultHome;
  if (base.startsWith('/agent') && !caps.canViewAgentPortal) return caps.defaultHome;
  if (base.startsWith('/hubs') && !caps.canViewHubsPortal) return caps.defaultHome;
  if (base.startsWith('/orders') && !caps.canViewCustomerOrders) return caps.defaultHome;
  if (base.startsWith('/support') && !caps.canViewCustomerSupport) return caps.defaultHome;
  if (base.startsWith('/business') && !caps.canViewBusinessPortal) return caps.defaultHome;
  return requestedRedirect;
}

export function AuthExperience({ initialMode = 'signin' }: { initialMode?: AuthMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [signInMethod, setSignInMethod] = useState<'password' | 'email_otp' | 'phone_otp'>('password');
  const [redirectParam, setRedirectParam] = useState<string | null>(null);

  // Global status banners
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Sign In: Password
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Sign In: Email OTP
  const [otpEmail, setOtpEmail] = useState('');
  const [emailOtpStep, setEmailOtpStep] = useState<'enter' | 'verify'>('enter');
  const [emailOtpCode, setEmailOtpCode] = useState('');

  // Sign In: Phone OTP
  const [phone, setPhone] = useState('');
  const [phoneOtpStep, setPhoneOtpStep] = useState<'enter' | 'verify'>('enter');
  const [phoneOtpCode, setPhoneOtpCode] = useState('');

  // Sign Up: Email OTP verified registration
  const [signupStep, setSignupStep] = useState<'form' | 'verify'>('form');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signupCode, setSignupCode] = useState('');

  // Forgot & Reset Password
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetConfirmPass, setResetConfirmPass] = useState('');
  const [resetComplete, setResetComplete] = useState(false);

  // Check URL ?redirect=... and existing active session cleanly
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const red = params.get('redirect');
      setRedirectParam(red);
      const qEmail = params.get('email');
      if (qEmail) {
        setResetEmail(qEmail);
        setLoginEmail(qEmail);
      }

      const existing = getToken();
      if (existing) {
        getMe(existing)
          .then((me) => {
            router.replace(resolvePostAuthRoute(me.role, red));
          })
          .catch(() => {
            clearToken();
          });
      }
    }
  }, [router]);

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setDevOtpHint(null);
    setResetComplete(false);
  };

  const finishAuth = (res: AuthLoginResult) => {
    setToken(
      res.accessToken,
      { role: res.role, user: res.user ?? null },
      res.refreshToken,
    );
    router.replace(resolvePostAuthRoute(res.role, redirectParam));
  };

  // --- Handlers: Sign In ---

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await staffLogin(loginEmail.trim(), loginPassword);
      finishAuth(res);
    } catch (err: any) {
      setError(err?.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailLoginOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!otpEmail.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    setDevOtpHint(null);
    try {
      const res = await sendEmailOtp(otpEmail.trim(), 'LOGIN_EMAIL');
      setEmailOtpStep('verify');
      setCooldown(45);
      setInfo(`Verification code sent to ${res.email}.`);
      if (res.devCode) setDevOtpHint(res.devCode);
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await verifyEmailOtp(otpEmail.trim(), emailOtpCode.trim());
      finishAuth(res);
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    setDevOtpHint(null);
    try {
      const res = await requestOtp(phone.trim());
      setPhoneOtpStep('verify');
      setCooldown(45);
      setInfo('SMS verification code sent.');
      if (res.devCode) setDevOtpHint(res.devCode);
    } catch (err: any) {
      setError(err?.message || 'Failed to send SMS OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(phone.trim(), phoneOtpCode.trim());
      finishAuth(res);
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  // --- Handlers: Sign Up (Email OTP Verification) ---

  const handleSendSignupOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (signupPassword !== signupConfirm) {
      setError('Password and confirmation do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    setDevOtpHint(null);
    try {
      const res = await sendSignupOtp({
        name: signupName.trim(),
        email: signupEmail.trim(),
        phone: signupPhone.trim() || undefined,
        password: signupPassword,
        confirmPassword: signupConfirm,
      });
      setSignupStep('verify');
      setCooldown(45);
      setInfo(`Enter the 6-digit verification code sent to ${res.email}.`);
      if (res.devCode) setDevOtpHint(res.devCode);
    } catch (err: any) {
      setError(err?.message || 'Could not start email verification');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await verifySignupOtp({
        name: signupName.trim(),
        email: signupEmail.trim(),
        phone: signupPhone.trim() || undefined,
        password: signupPassword,
        code: signupCode.trim(),
      });
      finishAuth(res);
    } catch (err: any) {
      setError(err?.message || 'Email verification failed');
    } finally {
      setLoading(false);
    }
  };

  // --- Handlers: Forgot & Reset Password ---

  const handleForgotSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!resetEmail.trim()) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    setDevOtpHint(null);
    try {
      const res = await forgotPasswordApi(resetEmail.trim());
      setMode('reset');
      setCooldown(45);
      setInfo(res.message);
      if (res.devCode) setDevOtpHint(res.devCode);
    } catch (err: any) {
      setError(err?.message || 'Unable to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetNewPass !== resetConfirmPass) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resetPasswordApi({
        email: resetEmail.trim(),
        code: resetCode.trim(),
        newPassword: resetNewPass,
        confirmPassword: resetConfirmPass,
      });
      setResetComplete(true);
      setInfo('Password updated cleanly! Sign in with your new password.');
      setDevOtpHint(null);
      setLoginEmail(resetEmail.trim());
      setLoginPassword('');
    } catch (err: any) {
      setError(err?.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  const applyDevQuickFill = (em: string, pw: string) => {
    switchMode('signin');
    setSignInMethod('password');
    setLoginEmail(em);
    setLoginPassword(pw);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      {/* Top Heading */}
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-700 border border-brand-100">
          <ShieldCheck className="h-3.5 w-3.5" /> Verified Account Access
        </span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900 tracking-tight">
          Welcome to <span className="text-brand-600">BookCourier</span>
        </h1>
        <p className="mt-1.5 text-xs text-slate-600">
          {mode === 'signup'
            ? 'Create a customer account with Email OTP verification.'
            : mode === 'forgot' || mode === 'reset'
              ? 'Verify your email OTP to set a new password.'
              : 'Sign in as a Customer, Employee, or Super Admin to continue.'}
        </p>
      </div>

      {/* Primary Sign In / Sign Up Switch */}
      {(mode === 'signin' || mode === 'signup') && (
        <div className="mt-6 flex rounded-lg bg-slate-200/80 p-1">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 rounded-md py-2 text-xs font-semibold transition ${
              mode === 'signin'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 rounded-md py-2 text-xs font-semibold transition ${
              mode === 'signup'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign Up
          </button>
        </div>
      )}

      {/* Main Card */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {info && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{info}</span>
          </div>
        )}

        {IS_DEV && devOtpHint && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Dev Console Email/SMS OTP Preview:{' '}
            <span className="font-mono font-bold tracking-wider">{devOtpHint}</span>
          </div>
        )}

        {/* ==================== SIGN IN ==================== */}
        {mode === 'signin' && (
          <>
            <div className="mb-5 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-100 p-1 text-[11px] font-semibold">
              {[
                { id: 'password', label: 'Password' },
                { id: 'email_otp', label: 'Email OTP' },
                { id: 'phone_otp', label: 'Phone OTP' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSignInMethod(m.id as 'password' | 'email_otp' | 'phone_otp');
                    setError(null);
                    setInfo(null);
                    setDevOtpHint(null);
                  }}
                  className={`rounded-md py-1.5 transition ${
                    signInMethod === m.id
                      ? 'bg-white text-brand-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {signInMethod === 'password' && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Email Address (Customer / Employee / Admin)
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="name@example.com"
                      autoComplete="email"
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                    />
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-700">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(loginEmail);
                        switchMode('forgot');
                      }}
                      className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <PasswordInput
                    value={loginPassword}
                    onChange={setLoginPassword}
                    autoComplete="current-password"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Sign In with Password'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            {signInMethod === 'email_otp' && (
              emailOtpStep === 'enter' ? (
                <form onSubmit={handleSendEmailLoginOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Registered Email Address
                    </label>
                    <div className="relative mt-1">
                      <input
                        type="email"
                        value={otpEmail}
                        onChange={(e) => setOtpEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                      />
                      <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send Email OTP'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyEmailLoginOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      6-Digit Email Verification Code
                    </label>
                    <div className="relative mt-1">
                      <input
                        type="text"
                        value={emailOtpCode}
                        onChange={(e) => setEmailOtpCode(e.target.value)}
                        placeholder="123456"
                        maxLength={6}
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm font-mono tracking-widest focus:border-brand-600 focus:outline-none"
                      />
                      <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <button
                      type="button"
                      onClick={() => setEmailOtpStep('enter')}
                      className="hover:text-slate-800"
                    >
                      Change email
                    </button>
                    <button
                      type="button"
                      disabled={cooldown > 0 || loading}
                      onClick={() => handleSendEmailLoginOtp()}
                      className="inline-flex items-center gap-1 font-semibold text-brand-600 disabled:text-slate-400"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )
            )}

            {signInMethod === 'phone_otp' && (
              phoneOtpStep === 'enter' ? (
                <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Registered Phone Number
                    </label>
                    <div className="relative mt-1">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="9000000010"
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                      />
                      <Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send SMS OTP'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">6-Digit SMS Code</label>
                    <div className="relative mt-1">
                      <input
                        type="text"
                        value={phoneOtpCode}
                        onChange={(e) => setPhoneOtpCode(e.target.value)}
                        placeholder="123456"
                        maxLength={6}
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm font-mono tracking-widest focus:border-brand-600 focus:outline-none"
                      />
                      <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhoneOtpStep('enter')}
                    className="w-full text-center text-[11px] text-slate-500 hover:text-slate-800"
                  >
                    Change phone number
                  </button>
                </form>
              )
            )}

            <p className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
              New customer?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="font-semibold text-brand-600 hover:underline"
              >
                Create an account with Email OTP
              </button>
            </p>
          </>
        )}

        {/* ==================== SIGN UP (EMAIL OTP VERIFICATION) ==================== */}
        {mode === 'signup' && (
          signupStep === 'form' ? (
            <form onSubmit={handleSendSignupOtp} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700">Full Name</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    placeholder="Priya Sharma"
                    required
                    minLength={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                  />
                  <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Email Address</label>
                <div className="relative mt-1">
                  <input
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                  />
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Phone Number <span className="text-slate-400">(optional, recommended for delivery OTP)</span>
                </label>
                <div className="relative mt-1">
                  <input
                    type="tel"
                    value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                  />
                  <Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Password <span className="text-slate-400">(8+ chars, letters &amp; numbers)</span>
                </label>
                <PasswordInput
                  value={signupPassword}
                  onChange={setSignupPassword}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Confirm Password</label>
                <PasswordInput
                  value={signupConfirm}
                  onChange={setSignupConfirm}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Sending Verification OTP...' : 'Verify Email & Continue'}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>

              <p className="pt-2 text-center text-xs text-slate-500">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  Sign In
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifySignup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  6-Digit Email Verification OTP
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={signupCode}
                    onChange={(e) => setSignupCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm font-mono tracking-widest focus:border-brand-600 focus:outline-none"
                  />
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Creating Verified Account...' : 'Verify Email & Create Account'}
              </button>

              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <button
                  type="button"
                  onClick={() => setSignupStep('form')}
                  className="inline-flex items-center gap-1 hover:text-slate-800"
                >
                  <ArrowLeft className="h-3 w-3" /> Edit details
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0 || loading}
                  onClick={() => handleSendSignupOtp()}
                  className="inline-flex items-center gap-1 font-semibold text-brand-600 disabled:text-slate-400"
                >
                  <RefreshCw className="h-3 w-3" />
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
                </button>
              </div>
            </form>
          )
        )}

        {/* ==================== FORGOT / RESET PASSWORD ==================== */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotSend} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Account Email Address
              </label>
              <div className="relative mt-1">
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                />
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Sending Reset OTP...' : 'Send Password Reset Code'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="flex w-full items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Sign In
            </button>
          </form>
        )}

        {mode === 'reset' && (
          resetComplete ? (
            <div className="space-y-4 text-center py-2">
              <p className="text-xs text-slate-600">
                Your password has been updated and previous sessions were signed out.
              </p>
              <button
                type="button"
                onClick={() => {
                  switchMode('signin');
                  setSignInMethod('password');
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Continue to Sign In <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700">Email Address</label>
                <div className="relative mt-1">
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-brand-600 focus:outline-none"
                  />
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  6-Digit Verification OTP
                </label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm font-mono tracking-widest focus:border-brand-600 focus:outline-none"
                  />
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  New Password <span className="text-slate-400">(8+ chars, letters &amp; numbers)</span>
                </label>
                <PasswordInput
                  value={resetNewPass}
                  onChange={setResetNewPass}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Confirm New Password
                </label>
                <PasswordInput
                  value={resetConfirmPass}
                  onChange={setResetConfirmPass}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand-600 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Updating Password...' : 'Reset Password'}
              </button>

              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="inline-flex items-center gap-1 hover:text-slate-800"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to Sign In
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0 || loading}
                  onClick={() => handleForgotSend()}
                  className="inline-flex items-center gap-1 font-semibold text-brand-600 disabled:text-slate-400"
                >
                  <RefreshCw className="h-3 w-3" />
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                </button>
              </div>
            </form>
          )
        )}
      </div>

      {/* Dev-only role quick-fill helper (hidden in production) */}
      {IS_DEV && mode === 'signin' && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-[11px] text-slate-600">
          <p className="font-semibold text-slate-700 mb-2">Dev Quick-Fill Accounts (Password Login):</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'Super Admin', email: 'admin@bookcourier.local', pass: 'admin1234' },
              { label: 'Ops Mgr', email: 'ops@bookcourier.local', pass: 'Staff1234' },
              { label: 'Hub Mgr', email: 'hub@bookcourier.local', pass: 'Staff1234' },
              { label: 'Support', email: 'support@bookcourier.local', pass: 'Staff1234' },
              { label: 'Finance', email: 'finance@bookcourier.local', pass: 'Staff1234' },
              { label: 'Agent Rama', email: 'agent.rama@bookcourier.local', pass: 'Staff1234' },
              { label: 'B2B Account', email: 'business@bookcourier.local', pass: 'Book1234' },
              { label: 'Customer (Rahul)', email: 'rahul.kumar@mail.com', pass: 'Book1234' },
            ].map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => applyDevQuickFill(acc.email, acc.pass)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium hover:border-brand-600 hover:text-brand-700"
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Preserve unused import satisfaction for defaultHomeForRole if needed */}
      <span className="hidden">{defaultHomeForRole(null)}</span>
      <div className="mt-4 flex justify-center gap-4 text-[11px] text-slate-400">
        <Link href="/login" className="hover:text-slate-600">Sign In</Link>
        <Link href="/register" className="hover:text-slate-600">Sign Up</Link>
        <Link href="/forgot-password" className="hover:text-slate-600">Reset Password</Link>
      </div>
    </div>
  );
}

