'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicShell } from '../../components/PublicShell';
import { AuthSplitLayout } from '../../components/AuthSplitLayout';
import { apiFetch } from '../../lib/api';
import { getToken, setToken } from '../../lib/auth';

type LoginStep = 'identifier' | 'phone-otp' | 'password' | 'otp';
type PhoneAccountsSource = 'login' | 'signup' | 'forgot-id';
const OTP_RESEND_DELAY_SECONDS = 30;
const OTP_MAX_RESENDS = 3;
const OTP_RESEND_LOCKOUT_SECONDS = 60 * 60;

type AccountSummary = {
  id: string;
  email?: string | null;
  username?: string | null;
};

function formatWaitLabel(seconds: number) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const hasPrefilled = useRef(false);

  const [step, setStep] = useState<LoginStep>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingIdentifier, setPendingIdentifier] = useState('');
  const [pendingPassword, setPendingPassword] = useState('');
  const [fromPhoneAccounts, setFromPhoneAccounts] = useState(false);
  const [accountsPhoneNumber, setAccountsPhoneNumber] = useState('');
  const [phoneAccountsSource, setPhoneAccountsSource] = useState<PhoneAccountsSource>('login');
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [otpNoticeDismissed, setOtpNoticeDismissed] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  const getSafeRedirect = () => {
    const validRedirects = ['/', '/dashboard', '/projects'];
    const from = searchParams.get('from');
    return from && validRedirects.some((route) => from.startsWith(route)) ? from : '/';
  };

  const completeLogin = (token: string) => {
    setToken(token);
    window.location.assign(getSafeRedirect());
  };

  const isValidUsername = (value: string) =>
    value.length >= 4 &&
    /[A-Za-z]/.test(value) &&
    /^[A-Za-z0-9._-]+$/.test(value);

  const isPhone = (value: string) => /^\+[0-9]{10,15}$/.test(value);
  const looksLikePhoneMissingCode = (value: string) => /^[0-9]{7,15}$/.test(value);

  useEffect(() => {
    if (getToken()) {
      window.location.replace('/');
    }
  }, []);

  useEffect(() => {
    if (hasPrefilled.current) {
      return;
    }
    const prefillIdentifier = searchParams.get('identifier');
    const prefillStep = searchParams.get('step');
    const fromParam = searchParams.get('from');
    const phoneParam = searchParams.get('phone');

    if (prefillIdentifier) {
      setIdentifier(prefillIdentifier);
      if (prefillStep === 'password' && (fromParam === 'phone-accounts' || fromParam === 'signup' || fromParam === 'forgot-id')) {
        setFromPhoneAccounts(true);
        setPhoneAccountsSource(
          fromParam === 'signup' ? 'signup' : fromParam === 'forgot-id' ? 'forgot-id' : 'login',
        );
        setAccountsPhoneNumber(phoneParam || prefillIdentifier);
        setStep('password');
      } else if (prefillStep === 'password') {
        setStep('password');
      }
      hasPrefilled.current = true;
    }
  }, [searchParams]);

  useEffect(() => {
    if (step === 'password') {
      passwordRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (!resendCountdown) {
      return;
    }
    const timer = window.setTimeout(() => {
      setResendCountdown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (resendCountdown === 0 && resendAttempts >= OTP_MAX_RESENDS) {
      setResendAttempts(0);
    }
  }, [resendCountdown, resendAttempts]);

  const startOtpCooldown = () => {
    setResendCountdown(OTP_RESEND_DELAY_SECONDS);
  };

  const startResendTimer = (seconds: number) => {
    setResendCountdown(seconds);
  };

  const showOtpNotice = (message: string) => {
    setOtpNotice(message);
    setOtpNoticeDismissed(false);
  };

  const resetOtpFeedback = () => {
    setOtpNotice(null);
    setOtpNoticeDismissed(false);
    setResendCountdown(0);
    setResendAttempts(0);
  };

  const otpNoticeMessage =
    otpNotice && !otpNoticeDismissed
      ? resendAttempts >= OTP_MAX_RESENDS
        ? `You have reached the resend limit. Please wait ${formatWaitLabel(resendCountdown)} before requesting another code.`
        : resendCountdown > 0
          ? `${otpNotice} You can resend in ${resendCountdown}s.`
          : `${otpNotice} You can request another code now.`
      : null;

  useEffect(() => {
    if (step !== 'otp' && step !== 'phone-otp') {
      setOtpNotice(null);
      setOtpNoticeDismissed(false);
      setResendCountdown(0);
      setResendAttempts(0);
    }
  }, [step]);

  const handleBack = () => {
    setError(null);
    resetOtpFeedback();
    if (step === 'otp') {
      setOtp('');
      setStep('password');
      return;
    }
    if (step === 'phone-otp') {
      setStep('identifier');
      return;
    }
    if (step === 'password' && fromPhoneAccounts) {
      router.push(
        `/signup?identifier=${encodeURIComponent(accountsPhoneNumber)}&step=phone-accounts&from=${phoneAccountsSource}`,
      );
      return;
    }
    setPassword('');
    setStep('identifier');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (step === 'identifier') {
      if (!identifier.trim()) {
        setError('Please enter your email, phone, or username.');
        return;
      }

      const trimmed = identifier.trim();
      const isEmail = /\S+@\S+\.\S+/.test(trimmed);
      const isPhoneNumber = isPhone(trimmed);
      const isUsername = isValidUsername(trimmed);

      if (looksLikePhoneMissingCode(trimmed)) {
        setError('Please include country code (e.g. +1 555 123 4567).');
        return;
      }
      if (!isEmail && !isPhoneNumber && !isUsername) {
        setError('Please enter a valid email, phone, or username.');
        return;
      }

      setIsLoading(true);
      try {
        if (isPhoneNumber) {
          const data = await apiFetch<{ accounts: AccountSummary[] }>('/auth/identifier-accounts', {
            method: 'POST',
            body: JSON.stringify({ identifier: trimmed }),
          });
          if (!data.accounts.length) {
            setError('No account found for this phone number.');
            return;
          }
          await apiFetch('/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ identifier: trimmed, purpose: 'IDENTIFIER_RECOVERY' }),
          });
          setResendAttempts(0);
          startOtpCooldown();
          showOtpNotice('Verification code sent.');
          setPendingIdentifier(trimmed);
          setOtp('');
          setStep('phone-otp');
          return;
        }

        if (isEmail) {
          const data = await apiFetch<{ exists: boolean }>('/auth/check-identifier', {
            method: 'POST',
            body: JSON.stringify({ identifier: trimmed }),
          });
          if (!data.exists) {
            setError('No account found for this email.');
            return;
          }
        } else {
          const data = await apiFetch<{ exists: boolean }>('/auth/check-username', {
            method: 'POST',
            body: JSON.stringify({ username: trimmed }),
          });
          if (!data.exists) {
            setError('No account found for this username.');
            return;
          }
        }
        setStep('password');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (step === 'phone-otp') {
      setIsLoading(true);
      try {
        await apiFetch('/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({
            identifier: pendingIdentifier,
            otp: otp.trim(),
            purpose: 'IDENTIFIER_RECOVERY',
          }),
        });
        router.push(`/signup?identifier=${encodeURIComponent(pendingIdentifier)}&step=phone-accounts&from=login`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (step === 'otp') {
      setIsLoading(true);
      try {
        await apiFetch('/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ identifier: pendingIdentifier, otp: otp.trim() }),
        });
        const loginData = await apiFetch<{
          token: string;
          user: { id: string; email?: string | null; name?: string | null };
        }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: pendingIdentifier, password: pendingPassword }),
        });
        completeLogin(loginData.token);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetch<{
        token: string;
        user: { id: string; email?: string | null; name?: string | null };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      completeLogin(data.token);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('verification')) {
        try {
          await apiFetch('/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ identifier: identifier.trim(), purpose: 'ACCOUNT_VERIFY' }),
          });
          setResendAttempts(0);
          startOtpCooldown();
          showOtpNotice('Verification code sent.');
          setError(null);
          setOtp('');
          setPendingIdentifier(identifier.trim());
          setPendingPassword(password);
          setStep('otp');
          return;
        } catch (sendErr) {
          setError(sendErr instanceof Error ? sendErr.message : 'Unable to send OTP.');
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  const forgotLabel = step === 'password' ? 'Forgot password?' : 'Forgot id?';
  const submitLabel =
    step === 'password'
      ? isLoading
        ? 'Logging in...'
        : 'Login'
      : isLoading
        ? 'Checking...'
        : 'Next';

  return (
    <PublicShell mode="login" hideHeader className="login-shell">
      <AuthSplitLayout
        intro={
          <>
            <strong>Log in</strong>, with your Uynis Account.
          </>
        }
        frameClassName="login-frame-grow"
      >
        <form className="login-form-inner" onSubmit={handleSubmit} noValidate>
          {step === 'identifier' ? (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="login-identifier">
                Email/Phone or Username
              </label>
              <input
                id="login-identifier"
                className="login-input"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Email/Phone or Username"
                required
              />
              <div className="login-meta-row">
                <Link className="login-link emphasis" href="/forgot-id">
                  {forgotLabel}
                </Link>
              </div>
            </div>
          ) : step === 'phone-otp' ? (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="login-phone-otp">
                OTP
              </label>
              <input
                id="login-phone-otp"
                className="login-input"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="Enter OTP"
                required
              />
            </div>
          ) : step === 'otp' ? (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="login-otp">
                OTP
              </label>
              <input
                id="login-otp"
                className="login-input"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="Enter OTP"
                required
              />
            </div>
          ) : (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="login-password">
                Password
              </label>
              <div className="login-input-wrap">
                <input
                  id="login-password"
                  className="login-input has-icon"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  required
                />
                <button
                  className="login-visibility"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M3 5l18 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M4.5 12s3.2-6 9.5-6c2 0 3.7.6 5.1 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <path d="M8.2 16.1c1.1.6 2.4.9 3.8.9 6.3 0 9.5-5 9.5-5a17 17 0 0 0-3-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <path d="M10 9.5a3.5 3.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="login-meta-row">
                <Link className="login-link emphasis" href="/forgot-password">
                  {forgotLabel}
                </Link>
              </div>
            </div>
          )}

          {step === 'identifier' ? (
            error ? null : (
              <p className="login-private">
                Need anonymity? Use{' '}
                <Link className="login-link emphasis" href="/private">
                  Private
                </Link>{' '}
                mode to sign in privately.
              </p>
            )
          ) : step === 'phone-otp' ? (
            error ? null : (
              <p className="login-private">
                Enter the OTP sent to your phone to continue.
                {resendCountdown === 0 && resendAttempts < OTP_MAX_RESENDS ? (
                  <button
                    className="login-link emphasis"
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch('/auth/send-otp', {
                          method: 'POST',
                          body: JSON.stringify({ identifier: pendingIdentifier, purpose: 'IDENTIFIER_RECOVERY' }),
                        });
                        const nextAttempts = resendAttempts + 1;
                        setResendAttempts(nextAttempts);
                        if (nextAttempts >= OTP_MAX_RESENDS) {
                          startResendTimer(OTP_RESEND_LOCKOUT_SECONDS);
                          showOtpNotice('A final OTP was sent.');
                        } else {
                          startOtpCooldown();
                          showOtpNotice('A new OTP was sent.');
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Unable to resend OTP.');
                      }
                    }}
                  >
                    Resend OTP
                  </button>
                ) : null}
              </p>
            )
          ) : step === 'otp' ? (
            error ? null : (
              <p className="login-private">
                Enter the OTP sent to your email or phone.
                {resendCountdown === 0 && resendAttempts < OTP_MAX_RESENDS ? (
                  <button
                    className="login-link emphasis"
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch('/auth/send-otp', {
                          method: 'POST',
                          body: JSON.stringify({ identifier: pendingIdentifier, purpose: 'ACCOUNT_VERIFY' }),
                        });
                        const nextAttempts = resendAttempts + 1;
                        setResendAttempts(nextAttempts);
                        if (nextAttempts >= OTP_MAX_RESENDS) {
                          startResendTimer(OTP_RESEND_LOCKOUT_SECONDS);
                          showOtpNotice('A final OTP was sent.');
                        } else {
                          startOtpCooldown();
                          showOtpNotice('A new OTP was sent.');
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Unable to resend OTP.');
                      }
                    }}
                  >
                    Resend OTP
                  </button>
                ) : null}
              </p>
            )
          ) : (
            <p className="login-private">
              Don&apos;t have an account?{' '}
              <Link className="login-link emphasis" href="/signup">
                Create Account
              </Link>
            </p>
          )}

          {error ? (
            <div className="login-inline-alert" role="status">
              <span>{error}</span>
              <button className="login-inline-close" type="button" onClick={() => setError(null)} aria-label="Dismiss">
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ) : otpNoticeMessage ? (
            <div className="login-inline-alert" role="status">
              <span>{otpNoticeMessage}</span>
              <button
                className="login-inline-close"
                type="button"
                onClick={() => setOtpNoticeDismissed(true)}
                aria-label="Dismiss"
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ) : null}

          <div className="login-actions">
            {step === 'password' || step === 'otp' || step === 'phone-otp' ? (
              <button className="login-link emphasis" type="button" onClick={handleBack}>
                Back
              </button>
            ) : (
              <Link className="login-link emphasis" href="/signup">
                Create Account
              </Link>
            )}
            <button className="login-button" type="submit" disabled={isLoading}>
              {step === 'otp'
                ? isLoading
                  ? 'Verifying...'
                  : 'Confirm'
                : step === 'phone-otp'
                  ? 'Confirm'
                  : submitLabel}
            </button>
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}
