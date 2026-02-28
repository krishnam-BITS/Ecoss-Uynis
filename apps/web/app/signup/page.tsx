'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicShell } from '../../components/PublicShell';
import { AuthSplitLayout } from '../../components/AuthSplitLayout';
import { ChevronDownIcon } from '../../components/icons/ChevronDownIcon';
import { apiFetch } from '../../lib/api';
import { getToken, setToken } from '../../lib/auth';

type SignupStep = 'email' | 'phone-otp' | 'phone-accounts' | 'name' | 'username' | 'profile' | 'password' | 'otp' | 'success';
const OTP_RESEND_DELAY_SECONDS = 30;
const OTP_MAX_RESENDS = 3;
const OTP_RESEND_LOCKOUT_SECONDS = 60 * 60;

type AccountSummary = { id: string; email?: string | null; username?: string | null };

type StrengthMeta = { label: string; value: number; color: string };

const strengthPalette: StrengthMeta[] = [
  { label: 'Too weak', value: 20, color: '#ef4444' },
  { label: 'Weak', value: 40, color: '#f97316' },
  { label: 'Okay', value: 60, color: '#facc15' },
  { label: 'Good', value: 80, color: '#22c55e' },
  { label: 'Strong', value: 100, color: '#16a34a' },
];

const monthOptions = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const genderOptions = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const isEmail = (value: string) => /\S+@\S+\.\S+/.test(value);
const isPhone = (value: string) => /^\+[0-9]{10,15}$/.test(value);
const looksLikePhoneMissingCode = (value: string) => /^[0-9]{7,15}$/.test(value);
const isValidUsername = (value: string) => value.length >= 4 && /[A-Za-z]/.test(value) && /^[A-Za-z0-9._-]+$/.test(value);
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

function sanitizeDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

function padTwoDigits(value: string) {
  return value.length === 1 ? value.padStart(2, '0') : value;
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

function isValidDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return false;
  const currentYear = new Date().getFullYear();
  if (y < 1900 || y > currentYear) return false;
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  return d >= 1 && d <= daysInMonth;
}

function getAge(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age -= 1;
  return age;
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isInitialized, setIsInitialized] = useState(false);
  const [step, setStep] = useState<SignupStep>('email');
  const [identifier, setIdentifier] = useState('');
  const [pendingIdentifier, setPendingIdentifier] = useState('');
  const [pendingUserId, setPendingUserId] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneAccounts, setPhoneAccounts] = useState<AccountSummary[]>([]);
  const [isFromLogin, setIsFromLogin] = useState(false);
  const [isFromForgotId, setIsFromForgotId] = useState(false);
  const [fromPhoneAccountsSelection, setFromPhoneAccountsSelection] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [pendingSessionToken, setPendingSessionToken] = useState<string | null>(null);
  const [verificationDeferred, setVerificationDeferred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [showUsernameError, setShowUsernameError] = useState(false);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [otpNoticeDismissed, setOtpNoticeDismissed] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  const [isMonthOpen, setIsMonthOpen] = useState(false);
  const [isGenderOpen, setIsGenderOpen] = useState(false);
  const monthRef = useRef<HTMLDivElement | null>(null);
  const genderRef = useRef<HTMLDivElement | null>(null);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    if (getToken()) window.location.replace('/');
  }, []);

  useEffect(() => {
    const prefill = searchParams.get('identifier');
    const prefillStep = searchParams.get('step');
    const fromPage = searchParams.get('from');

    if (fromPage === 'login') setIsFromLogin(true);
    if (fromPage === 'forgot-id') setIsFromForgotId(true);

    if (prefill) {
      setIdentifier(prefill);
      setPendingIdentifier(prefill);
      setPhoneVerified(true);
      if (prefillStep === 'phone-accounts') {
        setStep('phone-accounts');
        void (async () => {
          try {
            const data = await apiFetch<{ accounts: AccountSummary[] }>('/auth/identifier-accounts', {
              method: 'POST',
              body: JSON.stringify({ identifier: prefill }),
            });
            setPhoneAccounts(data.accounts ?? []);
          } catch {
            setPhoneAccounts([]);
          }
        })();
      }
    }

    setIsInitialized(true);
  }, [searchParams]);

  useEffect(() => {
    if (!isMonthOpen && !isGenderOpen) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (isMonthOpen && !monthRef.current?.contains(target)) setIsMonthOpen(false);
      if (isGenderOpen && !genderRef.current?.contains(target)) setIsGenderOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isMonthOpen, isGenderOpen]);

  useEffect(() => {
    if (step !== 'username') return;
    if (username.trim()) {
      setUsernameSuggestions([]);
      return;
    }

    const loadSuggestions = async () => {
      try {
        const emailForSuggestions = isEmail(identifier) ? identifier : undefined;
        const data = await apiFetch<{ suggestions: string[] }>('/auth/username-suggestions', {
          method: 'POST',
          body: JSON.stringify({ firstName, lastName, email: emailForSuggestions }),
        });
        setUsernameSuggestions(data.suggestions ?? []);
      } catch {
        setUsernameSuggestions([]);
      }
    };

    void loadSuggestions();
  }, [step, username, firstName, lastName, identifier]);

  useEffect(() => {
    if (step !== 'username') return;
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<{ exists: boolean }>('/auth/check-username', {
          method: 'POST',
          body: JSON.stringify({ username: trimmed }),
        });
        setUsernameStatus(data.exists ? 'taken' : 'available');
      } catch {
        setUsernameStatus('idle');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [step, username]);

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

  const resetPhoneSignupState = () => {
    setVerificationDeferred(false);
    setPhoneVerified(false);
    setPhoneAccounts([]);
    setPendingIdentifier('');
    setPendingUserId('');
    setFromPhoneAccountsSelection(false);
    setOtp('');
    setOtpNotice(null);
    setOtpNoticeDismissed(false);
    setResendCountdown(0);
    setResendAttempts(0);
  };

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

  const getPostAuthDestination = () => {
    const from = searchParams.get('from');
    if (!from || !from.startsWith('/') || from.startsWith('//')) {
      return '/';
    }
    return from;
  };

  const handleGoToDashboard = () => {
    setError(null);
    if (verificationDeferred) {
      window.location.assign(`/login?identifier=${encodeURIComponent(username.trim())}&step=password`);
      return;
    }
    if (!pendingSessionToken) {
      setError('Session expired. Please log in again.');
      return;
    }
    setToken(pendingSessionToken);
    window.location.assign(getPostAuthDestination());
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (step !== 'otp' && step !== 'phone-otp') {
      resetOtpFeedback();
    }

    if (step === 'email') {
      resetPhoneSignupState();
      const trimmed = identifier.trim();
      if (!trimmed) return setError('Please enter your email or phone number.');
      if (looksLikePhoneMissingCode(trimmed)) return setError('Please include country code (e.g. +1 555 123 4567).');
      if (!isEmail(trimmed) && !isPhone(trimmed)) return setError('Please enter a valid email or phone number.');

      setIsLoading(true);
      try {
        const data = await apiFetch<{ exists: boolean }>('/auth/check-identifier', { method: 'POST', body: JSON.stringify({ identifier: trimmed }) });
        if (isEmail(trimmed) && data.exists) return setError('An account already exists with this email. Please log in.');
        if (isPhone(trimmed) && data.exists) {
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
        setStep('name');
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
        const data = await apiFetch<{ accounts: AccountSummary[] }>('/auth/identifier-accounts', { method: 'POST', body: JSON.stringify({ identifier: pendingIdentifier }) });
        setPhoneAccounts(data.accounts ?? []);
        setPhoneVerified(true);
        setStep('phone-accounts');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (step === 'phone-accounts') {
      setFromPhoneAccountsSelection(true);
      setStep('name');
      return;
    }

    if (step === 'name') {
      if (!firstName.trim()) return setError('Please enter your first name.');
      setStep('username');
      return;
    }

    if (step === 'username') {
      const trimmed = username.trim();
      if (!trimmed) {
        setShowUsernameError(true);
        return setError('Please choose a username.');
      }
      if (!isValidUsername(trimmed)) {
        setShowUsernameError(true);
        return setError('Use at least 4 characters with letters, numbers, dots, or underscores.');
      }
      setIsLoading(true);
      try {
        const data = await apiFetch<{ exists: boolean }>('/auth/check-username', { method: 'POST', body: JSON.stringify({ username: trimmed }) });
        if (data.exists) {
          setUsernameStatus('taken');
          setShowUsernameError(true);
          return setError('That username is already taken. Try another one.');
        }
        setUsernameStatus('available');
        setShowUsernameError(false);
        setStep('profile');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (step === 'profile') {
      const normalizedDay = padTwoDigits(birthDay);
      if (!birthMonth || !birthDay || !birthYear) return setError('Please enter your date of birth.');
      if (!isValidDate(birthYear, birthMonth, normalizedDay)) return setError('Please enter a valid date of birth.');
      if (getAge(birthYear, birthMonth, normalizedDay) < 13) return setError('You must be at least 13 years old to register.');
      if (!gender.trim()) return setError('Please select a gender.');
      setBirthDay(normalizedDay);
      setStep('password');
      return;
    }

    if (step === 'password') {
      const passwordError = validatePassword(password, {
        username: username.trim(),
        identifier,
      });
      if (passwordError) return setError(passwordError);
      if (password !== confirmPassword) return setError('Passwords do not match.');
      const dateOfBirth = `${birthYear}-${birthMonth}-${birthDay.padStart(2, '0')}`;

      setIsLoading(true);
      try {
        const signupData = await apiFetch<{
          user: { id: string };
          pendingVerification?: boolean;
          otpSent?: boolean;
          deliveryIssue?: boolean;
          message?: string;
        }>('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: isEmail(identifier) ? identifier : undefined,
            phone: isPhone(identifier) ? identifier : undefined,
            username: username.trim(),
            password,
            firstName,
            lastName: lastName.trim() || undefined,
            dateOfBirth,
            gender,
            skipVerification: phoneVerified || undefined,
          }),
        });

        setPendingUserId(signupData.user.id);

        if (phoneVerified) {
          const loginData = await apiFetch<{ token: string }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier: username.trim(), password }),
          });
          setPendingSessionToken(loginData.token);
          setVerificationDeferred(false);
          setStep('success');
          return;
        }

        if (signupData.otpSent === false || signupData.deliveryIssue) {
          setVerificationDeferred(true);
          setPendingSessionToken(null);
          setError(
            signupData.message ||
              'Your account was created, but we could not send a verification code right now. Try logging in later to resend it.',
          );
          setStep('success');
          return;
        }

        setPendingIdentifier(identifier.trim());
        setResendAttempts(0);
        startOtpCooldown();
        showOtpNotice('Verification code sent.');
        setVerificationDeferred(false);
        setStep('otp');
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
          body: JSON.stringify({ identifier: pendingIdentifier, otp: otp.trim(), userId: pendingUserId || undefined }),
        });
        const loginData = await apiFetch<{ token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: username.trim(), password }),
        });
        setPendingSessionToken(loginData.token);
        setStep('success');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (step === 'success') {
      handleGoToDashboard();
    }
  };

  const introText =
    step === 'phone-otp' ? 'An account already exists with this phone. Verify to add another.'
    : step === 'phone-accounts' ? 'Accounts already linked to this phone.'
    : step === 'name' ? 'Enter your first and last name.'
    : step === 'username' ? 'Choose a username that feels like you.'
    : step === 'profile' ? 'Enter your birthday and gender.'
    : step === 'password' ? 'Create a strong password to protect your account.'
    : step === 'otp' ? 'Verify your account with OTP.'
    : step === 'success' ? (verificationDeferred ? 'Account created. Verification is still pending.' : 'Your account is ready.')
    : 'Create your Uynis account.';

  if (!isInitialized) {
    return (
      <PublicShell mode="signup" hideHeader className="login-shell">
        {null}
      </PublicShell>
    );
  }

  return (
    <PublicShell mode="signup" hideHeader className="login-shell">
      <AuthSplitLayout intro={<><strong>{introText}</strong></>} frameClassName="login-frame-grow">
        <form className="login-form-inner" onSubmit={handleSubmit} noValidate>
          {step === 'email' ? (
            <div className="login-field-group">
              <input
                id="signup-identifier"
                className="login-input"
                type="text"
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  if (
                    phoneVerified ||
                    phoneAccounts.length ||
                    fromPhoneAccountsSelection ||
                    pendingIdentifier ||
                    pendingUserId ||
                    otp
                  ) {
                    resetPhoneSignupState();
                  }
                }}
                placeholder="Email or phone"
                required
              />
            </div>
          ) : null}

          {step === 'phone-accounts' ? (
            <div className="login-field-group">
              <h2 className="login-title">Accounts found</h2>
              <p className="login-copy">Accounts linked to this phone:</p>
              <div className="login-list login-list-scroll">
                {phoneAccounts.map((account) => (
                  <Link key={account.id} className="login-list-item login-list-link" href={`/login?identifier=${encodeURIComponent(account.username ?? account.email ?? '')}&step=password${isFromLogin ? `&from=phone-accounts&phone=${encodeURIComponent(pendingIdentifier)}` : isFromForgotId ? `&from=forgot-id&phone=${encodeURIComponent(pendingIdentifier)}` : `&from=signup&phone=${encodeURIComponent(pendingIdentifier)}`}`}>
                    <span className="login-list-title">{account.username ?? 'Unnamed account'}</span>
                    <span className="login-list-sub">{account.email ? `Email: ${account.email}` : 'Phone-only account'}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {step === 'name' ? (
            <>
              <div className="login-field-group"><input className="login-input" type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" required /></div>
              <div className="login-field-group"><input className="login-input" type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name (optional)" /></div>
            </>
          ) : null}

          {step === 'username' ? (
            <>
              <div className="login-field-group">
                <div className="login-input-wrap">
                  <input
                    className="login-input"
                    type="text"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setUsernameStatus('idle');
                      setShowUsernameError(false);
                      if (usernameSuggestions.length) setUsernameSuggestions([]);
                    }}
                    placeholder="Username"
                    required
                  />
                  <span className={`login-availability ${usernameStatus}`} aria-hidden="true" />
                </div>
              </div>
              {usernameSuggestions.length ? (
                <div className="login-suggestions">
                  {usernameSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="login-suggestion" onClick={() => setUsername(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {step === 'profile' ? (
            <>
              <div className="login-field-row login-field-row-three">
                <div className="login-field-group">
                  <div className="login-select-wrap" ref={monthRef}>
                    <button className={`login-input login-select ${birthMonth ? '' : 'placeholder'}`} type="button" onClick={() => setIsMonthOpen((open) => !open)}>
                      <span>{monthOptions.find((item) => item.value === birthMonth)?.label ?? 'Month'}</span>
                      <ChevronDownIcon />
                    </button>
                    {isMonthOpen ? (
                      <div className="login-select-menu" role="listbox">
                        {monthOptions.map((option) => (
                          <button key={option.value} type="button" className="login-select-option" onClick={() => { setBirthMonth(option.value); setIsMonthOpen(false); }}>{option.label}</button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="login-field-group"><input className="login-input" type="text" inputMode="numeric" value={birthDay} onChange={(event) => setBirthDay(sanitizeDigits(event.target.value, 2))} placeholder="DD" required /></div>
                <div className="login-field-group"><input className="login-input" type="text" inputMode="numeric" value={birthYear} onChange={(event) => setBirthYear(sanitizeDigits(event.target.value, 4))} placeholder="YYYY" required /></div>
              </div>
              <div className="login-field-group">
                <div className="login-select-wrap" ref={genderRef}>
                  <button className={`login-input login-select ${gender ? '' : 'placeholder'}`} type="button" onClick={() => setIsGenderOpen((open) => !open)}>
                    <span>{genderOptions.find((option) => option.value === gender)?.label ?? 'Gender'}</span>
                    <ChevronDownIcon />
                  </button>
                  {isGenderOpen ? (
                    <div className="login-select-menu" role="listbox">
                      {genderOptions.map((option) => (
                        <button key={option.value} type="button" className="login-select-option" onClick={() => { setGender(option.value); setIsGenderOpen(false); }}>{option.label}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {step === 'password' ? (
            <>
              <div className="login-field-group">
                <div className="login-input-wrap">
                  <input className="login-input has-icon" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
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
                <div className="login-strength"><span className="login-strength-bar"><span className="login-strength-fill" style={{ width: `${passwordStrength.value}%`, backgroundColor: passwordStrength.color }} /></span><span className="login-strength-label">{passwordStrength.label}</span></div>
              </div>
              <div className="login-field-group">
                <div className="login-input-wrap">
                  <input className="login-input has-icon" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter password" required />
                  <button
                    className="login-visibility"
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
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
            </>
          ) : null}

          {step === 'otp' || step === 'phone-otp' ? (
            <div className="login-field-group"><input className="login-input" type="text" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="Enter OTP" required /></div>
          ) : null}

          {step === 'success' ? (
            <div className="login-field-group">
              <div className="private-success-card">
                <div className="private-success-copy">
                  <p className="private-success-title">Account created</p>
                  <p className="private-success-subtitle">
                    <strong>{username.trim()}</strong>{' '}
                    {verificationDeferred
                      ? 'was created, but verification is still pending because code delivery was not confirmed. Use login later to request a new code.'
                      : 'is ready. Continue to your dashboard or login.'}
                  </p>
                </div>
                <div className="private-success-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5 9.2 17 19 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'username' && error && showUsernameError ? (
            <div className="login-inline-alert" role="status">
              <span>{error}</span>
              <button className="login-inline-close" type="button" onClick={() => setShowUsernameError(false)} aria-label="Dismiss">
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ) : null}

          {step !== 'username' && error ? (
            <div className="login-inline-alert" role="status">
              <span>{error}</span>
              <button className="login-inline-close" type="button" onClick={() => setError(null)} aria-label="Dismiss">
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ) : step !== 'username' && otpNoticeMessage ? (
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

          {step === 'email' && !error ? (
            <p className="login-private">
              Enter the email or phone number you want to use for your Uynis account.
            </p>
          ) : null}

          {(step === 'otp' || step === 'phone-otp') && !error ? (
            <p className="login-private">
              {step === 'phone-otp' ? 'Enter the OTP sent to your phone to add another account.' : 'Enter the OTP sent to your email or phone. You can verify within 3 days, or your account will be deleted.'}
              {resendCountdown === 0 && resendAttempts < OTP_MAX_RESENDS ? (
                <button
                  className="login-link emphasis"
                  type="button"
                  onClick={async () => {
                    try {
                      await apiFetch('/auth/send-otp', {
                        method: 'POST',
                        body: JSON.stringify({
                          identifier: pendingIdentifier,
                          purpose: step === 'phone-otp' ? 'IDENTIFIER_RECOVERY' : 'ACCOUNT_VERIFY',
                          userId: step === 'otp' ? pendingUserId || undefined : undefined,
                        }),
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
          ) : null}

          <div className="login-actions">
            {step === 'email' ? <Link className="login-link emphasis" href="/login">Login</Link>
              : step === 'phone-otp' ? <button className="login-link emphasis" type="button" onClick={() => { resetPhoneSignupState(); setStep('email'); }}>Back</button>
              : step === 'phone-accounts' ? (isFromLogin ? <Link className="login-link emphasis" href="/login">Cancel</Link> : isFromForgotId ? <Link className="login-link emphasis" href="/forgot-id">Cancel</Link> : <button className="login-link emphasis" type="button" onClick={() => { resetPhoneSignupState(); setStep('email'); }}>Cancel</button>)
              : step === 'name' ? (
                <button
                  className="login-link emphasis"
                  type="button"
                  onClick={() => {
                    if (fromPhoneAccountsSelection) {
                      setStep('phone-accounts');
                      return;
                    }
                    resetPhoneSignupState();
                    setStep('email');
                  }}
                >
                  Back
                </button>
              )
              : step === 'username' ? <button className="login-link emphasis" type="button" onClick={() => (fromPhoneAccountsSelection ? setStep('phone-accounts') : setStep('name'))}>Back</button>
              : step === 'profile' ? <button className="login-link emphasis" type="button" onClick={() => setStep('username')}>Back</button>
              : step === 'otp' ? <Link className="login-link emphasis" href="/login">Login</Link>
              : step === 'success' ? <Link className="login-link emphasis" href={`/login?identifier=${encodeURIComponent(username.trim())}&step=password`}>Login</Link>
              : <button className="login-link emphasis" type="button" onClick={() => setStep('profile')}>Back</button>}
            {step === 'success' ? (
              <button className="login-button" type="button" onClick={handleGoToDashboard}>
                {verificationDeferred ? 'Go to login' : 'Go to dashboard'}
              </button>
            ) : (
              <button className="login-button" type="submit" disabled={isLoading}>
                {step === 'password' ? (isLoading ? 'Processing...' : 'Next') : step === 'otp' || step === 'phone-otp' ? (isLoading ? 'Verifying...' : 'Confirm') : step === 'phone-accounts' ? 'Add account' : (isLoading ? 'Checking...' : 'Next')}
              </button>
            )}
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}
