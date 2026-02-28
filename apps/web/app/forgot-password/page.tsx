'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '../../components/PublicShell';
import { AuthSplitLayout } from '../../components/AuthSplitLayout';
import { apiFetch } from '../../lib/api';
import { setToken } from '../../lib/auth';

function isEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

function isPhone(value: string) {
  return /^\+[0-9]{10,15}$/.test(value);
}

function looksLikePhoneMissingCode(value: string) {
  return /^[0-9]{7,15}$/.test(value);
}

function isValidUsername(value: string) {
  return value.length >= 4 && /[A-Za-z]/.test(value) && /^[A-Za-z0-9._-]+$/.test(value);
}

type StrengthMeta = {
  label: string;
  value: number;
  color: string;
};
const OTP_RESEND_DELAY_SECONDS = 30;
const OTP_MAX_RESENDS = 3;
const OTP_RESEND_LOCKOUT_SECONDS = 60 * 60;

const strengthPalette: StrengthMeta[] = [
  { label: 'Too weak', value: 20, color: '#ef4444' },
  { label: 'Weak', value: 40, color: '#f97316' },
  { label: 'Okay', value: 60, color: '#facc15' },
  { label: 'Good', value: 80, color: '#22c55e' },
  { label: 'Strong', value: 100, color: '#16a34a' },
];

function getPasswordStrength(value: string): StrengthMeta {
  if (!value) return strengthPalette[0];
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[a-z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return strengthPalette[Math.min(score, strengthPalette.length - 1)];
}

const commonPasswords = new Set([
  'password',
  'password1',
  'password123',
  'qwerty',
  'qwerty123',
  'abc123',
  'admin',
  'welcome',
  'letmein',
  'iloveyou',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '000000',
  '111111',
  '123123',
  '654321',
  'user',
  'user123',
]);

function hasSequence(value: string) {
  const lower = value.toLowerCase();
  const sequences = ['abcdefghijklmnopqrstuvwxyz', '0123456789'];
  return sequences.some((sequence) => {
    for (let i = 0; i <= sequence.length - 4; i += 1) {
      const chunk = sequence.slice(i, i + 4);
      if (lower.includes(chunk)) return true;
      if (lower.includes(chunk.split('').reverse().join(''))) return true;
    }
    return false;
  });
}

function hasRepeats(value: string) {
  return /(.)\1\1/.test(value) || /(..).?\1/.test(value);
}

function sanitizeIdentity(value: string | undefined) {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validatePassword(value: string, context: { username: string; identifier: string }) {
  if (!value) return 'Please create a password.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) {
    return 'Password must include uppercase and lowercase letters.';
  }
  if (!/[0-9]/.test(value)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include a special character.';

  const normalized = sanitizeIdentity(value);
  const normalizedUsername = sanitizeIdentity(context.username);
  const normalizedIdentifier = sanitizeIdentity(context.identifier);
  if (normalizedUsername && normalized.includes(normalizedUsername)) {
    return 'Password should not include your username.';
  }
  if (normalizedIdentifier && normalized.includes(normalizedIdentifier)) {
    return 'Password should not include your email or phone.';
  }
  if (commonPasswords.has(value.toLowerCase())) {
    return 'Password is too common. Choose a stronger one.';
  }
  if (hasSequence(value)) return 'Avoid simple sequences like 1234 or abcd.';
  if (hasRepeats(value)) return 'Avoid repeated patterns.';
  return null;
}

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

type ResetOptions = {
  accountId: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  emailMasked: string | null;
  phoneMasked: string | null;
  isPrivateAccount: boolean;
};

type AccountOption = {
  id: string;
  email?: string | null;
  username?: string | null;
};

type Step =
  | 'identifier'
  | 'choose-method'
  | 'otp'
  | 'phone-otp'
  | 'phone-accounts'
  | 'post-verify'
  | 'reset-password';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [identifierKind, setIdentifierKind] = useState<'email' | 'username' | 'phone' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [options, setOptions] = useState<ResetOptions | null>(null);
  const [method, setMethod] = useState<'email' | 'phone' | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'email' | 'phone' | null>(null);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [otpNoticeDismissed, setOtpNoticeDismissed] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);
  const [contactIdentifier, setContactIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [verifiedOtp, setVerifiedOtp] = useState('');
  const [phoneAccounts, setPhoneAccounts] = useState<AccountOption[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountOption | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

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

  const resetOtpNotice = () => {
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

  const finishAuth = (token: string) => {
    setToken(token);
    window.location.assign('/');
  };

  const handleStart = async () => {
    setError(null);
    resetOtpNotice();
    const trimmed = identifier.trim();
    if (!trimmed) return setError('Please enter your email, phone, or username.');
    if (looksLikePhoneMissingCode(trimmed)) return setError('Please include country code (e.g. +1 555 123 4567).');

    if (isPhone(trimmed)) {
      setIsLoading(true);
      try {
        const data = await apiFetch<{ accounts: Array<{ id: string }> }>('/auth/identifier-accounts', {
          method: 'POST',
          body: JSON.stringify({ identifier: trimmed }),
        });
        if (!data.accounts.length) return setError('No account found for this phone number.');
        await apiFetch('/auth/send-reset-otp', {
          method: 'POST',
          body: JSON.stringify({ method: 'phone', identifier: trimmed }),
        });
        setContactIdentifier(trimmed);
        setMethod('phone');
        setIdentifierKind('phone');
        setResendAttempts(0);
        startOtpCooldown();
        showOtpNotice('Verification code sent.');
        setStep('phone-otp');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!isEmail(trimmed) && !isValidUsername(trimmed)) {
      setError('Please enter a valid email, phone, or username.');
      return;
    }

    setIdentifierKind(isEmail(trimmed) ? 'email' : 'username');
    setIsLoading(true);
    try {
      const data = await apiFetch<ResetOptions>('/auth/reset-options', {
        method: 'POST',
        body: JSON.stringify({ identifier: trimmed }),
      });
      if (data.isPrivateAccount || (!data.hasEmail && !data.hasPhone)) {
        setError('This account uses a recovery phrase. Please use Private Account Recovery.');
        return;
      }
      setOptions(data);
      setSelectedAccount({ id: data.accountId, username: data.username, email: data.email });
      setSelectedMethod(null);
      setStep('choose-method');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to find account.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async (picked: 'email' | 'phone') => {
    if (!options) return;
    setError(null);
    setIsLoading(true);
    resetOtpNotice();
    try {
      const target = picked === 'email' ? options.email : options.phone;
      if (!target) {
        setError('This contact method is not available.');
        return;
      }
      await apiFetch('/auth/send-reset-otp', {
        method: 'POST',
        body: JSON.stringify({ method: picked, identifier: target, accountId: options.accountId }),
      });
      setResendAttempts(0);
      startOtpCooldown();
      showOtpNotice('Verification code sent.');
      setMethod(picked);
      setContactIdentifier(target);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!method || !contactIdentifier) return;
    setError(null);
    setIsLoading(true);
    try {
      const data = await apiFetch<{ verified: boolean }>('/auth/verify-reset-otp', {
        method: 'POST',
        body: JSON.stringify({
          method,
          identifier: contactIdentifier,
          otp: otp.trim(),
          accountId: selectedAccount?.id,
        }),
      });
      if (data.verified) {
        setVerifiedOtp(otp.trim());
        setStep('post-verify');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    if (!contactIdentifier) return;
    setError(null);
    setIsLoading(true);
    try {
      const data = await apiFetch<{ verified: boolean }>('/auth/verify-reset-otp', {
        method: 'POST',
        body: JSON.stringify({
          method: 'phone',
          identifier: contactIdentifier,
          otp: otp.trim(),
        }),
      });
      if (data.verified) {
        setVerifiedOtp(otp.trim());
        const accounts = await apiFetch<{ accounts: AccountOption[] }>('/auth/phone-accounts', {
          method: 'POST',
          body: JSON.stringify({ phone: contactIdentifier }),
        });
        setPhoneAccounts(accounts.accounts);
        setStep('phone-accounts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginWithOtp = async () => {
    if (!method || !contactIdentifier || !verifiedOtp || !selectedAccount) return;
    setError(null);
    setIsLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/auth/login-with-otp', {
        method: 'POST',
        body: JSON.stringify({
          method,
          identifier: contactIdentifier,
          otp: verifiedOtp,
          accountId: selectedAccount.id,
        }),
      });
      if (data.token) {
        finishAuth(data.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!method || !contactIdentifier) return;
    if (resendCountdown > 0 || resendAttempts >= OTP_MAX_RESENDS) return;
    setError(null);
    setIsLoading(true);
    try {
      await apiFetch('/auth/send-reset-otp', {
        method: 'POST',
        body: JSON.stringify({ method, identifier: contactIdentifier, accountId: selectedAccount?.id }),
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
      setError(err instanceof Error ? err.message : 'Unable to resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccountContinue = async () => {
    if (!selectedAccount || !verifiedOtp || !contactIdentifier) return;
    setError(null);
    setIsLoading(true);
    try {
      const data = await apiFetch<{ verified: boolean }>('/auth/verify-reset-otp', {
        method: 'POST',
        body: JSON.stringify({
          method: 'phone',
          identifier: contactIdentifier,
          otp: verifiedOtp,
          accountId: selectedAccount.id,
        }),
      });
      if (data.verified) setStep('post-verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedAccount) return;
    setError(null);
    const passwordError = validatePassword(newPassword, {
      username: selectedAccount.username ?? '',
      identifier,
    });
    if (passwordError) return setError(passwordError);
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');

    setIsLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          accountId: selectedAccount.id,
          newPassword,
        }),
      });
      if (data.token) {
        finishAuth(data.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  const introTitle =
    step === 'otp' || step === 'phone-otp'
      ? 'Verify your OTP'
      : step === 'reset-password'
        ? 'Set a new password'
        : 'Reset password';

  const otpTarget =
    method === 'email'
      ? identifierKind === 'email'
        ? options?.email || contactIdentifier
        : options?.emailMasked || contactIdentifier
      : options?.phoneMasked || contactIdentifier;

  return (
    <PublicShell hideHeader className="login-shell">
      <AuthSplitLayout
        intro={
          <>
            <strong>{introTitle}</strong>
            {step === 'choose-method' ? (
              <span style={{ display: 'block', marginTop: '12px', fontSize: '14px', color: '#8b949e' }}>
                Choose how you want to verify your account.
              </span>
            ) : null}
            {step === 'phone-accounts' ? (
              <span style={{ display: 'block', marginTop: '12px', fontSize: '14px', color: '#8b949e' }}>
                Select the account you want to recover.
              </span>
            ) : null}
            {step === 'reset-password' ? (
              <div style={{ marginTop: '16px', color: '#8b949e', fontSize: '14px', lineHeight: '1.6' }}>
                <div>• Use at least 8 characters</div>
                <div>• Include uppercase & lowercase letters</div>
                <div>• Include at least one number</div>
                <div>• Include at least one special character</div>
              </div>
            ) : null}
          </>
        }
        frameClassName="login-frame-grow"
      >
        <form className="login-form-inner" onSubmit={(event) => event.preventDefault()} noValidate>
          {step === 'identifier' ? (
            <div className="login-field-group">
              <input
                id="forgot-password-identifier"
                className="login-input"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Email, phone, or username"
                required
              />
            </div>
          ) : null}

          {step === 'choose-method' && options ? (
            <div className="login-field-group">
              <h2 className="login-title">Select verification method</h2>
              <p className="login-copy">Username: <strong>{options.username ?? 'Unknown'}</strong></p>
              <div className="login-list">
                {options.hasEmail ? (
                  <button
                    type="button"
                    className="login-list-item login-list-link"
                    onClick={() => setSelectedMethod('email')}
                    style={{
                      borderColor: selectedMethod === 'email' ? '#929cd7' : 'rgba(240, 246, 252, 0.12)',
                    }}
                  >
                    <span className="login-list-title">{identifierKind === 'email' ? options.email : options.emailMasked}</span>
                  </button>
                ) : null}
                {options.hasPhone ? (
                  <button
                    type="button"
                    className="login-list-item login-list-link"
                    onClick={() => setSelectedMethod('phone')}
                    style={{
                      borderColor: selectedMethod === 'phone' ? '#929cd7' : 'rgba(240, 246, 252, 0.12)',
                    }}
                  >
                    <span className="login-list-title">{options.phoneMasked}</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {(step === 'otp' || step === 'phone-otp') ? (
            <div className="login-field-group">
              <input
                id="forgot-password-otp"
                className="login-input"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="Enter verification code"
                required
              />
              {!error ? (
                <p className="login-private">
                  {step === 'phone-otp' ? 'Enter the OTP sent to your phone.' : `Enter the OTP sent to ${otpTarget}.`}
                  {resendCountdown === 0 && resendAttempts < OTP_MAX_RESENDS ? (
                    <button
                      className="login-link emphasis"
                      type="button"
                      onClick={handleResendOtp}
                    >
                      Resend OTP
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'phone-accounts' ? (
            <div className="login-field-group">
              <h2 className="login-title">Accounts found</h2>
              <p className="login-copy">Choose the account to recover:</p>
              <div className="login-list login-list-scroll">
                {phoneAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className={`login-list-item login-list-link ${selectedAccount?.id === account.id ? 'active' : ''}`.trim()}
                    onClick={() => setSelectedAccount(account)}
                  >
                    <span className="login-list-title">{account.username ?? 'Unnamed account'}</span>
                    <span className="login-list-sub">{account.email ? `Email: ${account.email}` : 'Phone-only account'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 'post-verify' ? (
            <div className="login-field-group">
              <h2 className="login-title">Account verified</h2>
              <p className="login-copy">
                {selectedAccount?.username ? `Account: ${selectedAccount.username}` : 'Your account is verified.'}
              </p>
            </div>
          ) : null}

          {step === 'reset-password' ? (
            <div className="login-field-group">
              <div className="login-input-wrap">
                <input
                  className="login-input has-icon"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password"
                  required
                />
                <button className="login-visibility" type="button" onClick={() => setShowPassword((value) => !value)}>
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
              <div className="login-strength">
                <span className="login-strength-bar">
                  <span className="login-strength-fill" style={{ width: `${passwordStrength.value}%`, backgroundColor: passwordStrength.color }} />
                </span>
                <span className="login-strength-label">{passwordStrength.label}</span>
              </div>
              <div className="login-input-wrap">
                <input
                  className="login-input has-icon"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm new password"
                  required
                />
                <button className="login-visibility" type="button" onClick={() => setShowConfirmPassword((value) => !value)}>
                  {showConfirmPassword ? (
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
            </div>
          ) : null}

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
            {step === 'identifier' ? (
              <>
                <Link className="login-link emphasis" href="/login">Login</Link>
                <button className="login-button" type="button" onClick={handleStart} disabled={isLoading}>
                  {isLoading ? 'Searching...' : 'Search'}
                </button>
              </>
            ) : step === 'choose-method' ? (
              <>
                <button
                  className="login-link emphasis"
                  type="button"
                  onClick={() => {
                    resetOtpNotice();
                    setStep('identifier');
                  }}
                >
                  Not you?
                </button>
                <button className="login-button" type="button" onClick={() => selectedMethod && handleSendOtp(selectedMethod)} disabled={!selectedMethod || isLoading}>
                  {isLoading ? 'Sending...' : 'Continue'}
                </button>
              </>
            ) : step === 'otp' ? (
              <>
                <button
                  className="login-link emphasis"
                  type="button"
                  onClick={() => {
                    resetOtpNotice();
                    setStep('choose-method');
                  }}
                >
                  Back
                </button>
                <button className="login-button" type="button" onClick={handleVerifyOtp} disabled={isLoading}>
                  {isLoading ? 'Verifying...' : 'Verify'}
                </button>
              </>
            ) : step === 'phone-otp' ? (
              <>
                <button
                  className="login-link emphasis"
                  type="button"
                  onClick={() => {
                    resetOtpNotice();
                    setStep('identifier');
                  }}
                >
                  Back
                </button>
                <button className="login-button" type="button" onClick={handleVerifyPhoneOtp} disabled={isLoading}>
                  {isLoading ? 'Verifying...' : 'Verify'}
                </button>
              </>
            ) : step === 'phone-accounts' ? (
              <>
                <button className="login-link emphasis" type="button" onClick={() => router.push('/login')}>Cancel</button>
                <button className="login-button" type="button" onClick={handleAccountContinue} disabled={!selectedAccount}>
                  Continue
                </button>
              </>
            ) : step === 'post-verify' ? (
              <>
                <button className="login-link emphasis" type="button" onClick={handleLoginWithOtp} disabled={isLoading}>
                  {isLoading ? 'Logging in...' : 'Login'}
                </button>
                <button className="login-button" type="button" onClick={() => setStep('reset-password')}>
                  Change password
                </button>
              </>
            ) : (
              <>
                <button className="login-link emphasis" type="button" onClick={() => setStep('post-verify')}>
                  Back
                </button>
                <button className="login-button" type="button" onClick={handleResetPassword} disabled={isLoading}>
                  {isLoading ? 'Saving...' : 'Update password'}
                </button>
              </>
            )}
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}
