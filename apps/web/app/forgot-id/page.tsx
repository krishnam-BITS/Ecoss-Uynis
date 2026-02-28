'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicShell } from '../../components/PublicShell';
import { AuthSplitLayout } from '../../components/AuthSplitLayout';
import { apiFetch } from '../../lib/api';

type ForgotIdStep = 'search' | 'otp';
const OTP_RESEND_DELAY_SECONDS = 30;
const OTP_MAX_RESENDS = 3;
const OTP_RESEND_LOCKOUT_SECONDS = 60 * 60;

function isPhone(value: string) {
  return /^\+[0-9]{10,15}$/.test(value);
}

function looksLikePhoneMissingCode(value: string) {
  return /^[0-9]{7,15}$/.test(value);
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

export default function ForgotIdPage() {
  const router = useRouter();
  const [step, setStep] = useState<ForgotIdStep>('search');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [otpNoticeDismissed, setOtpNoticeDismissed] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

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
        ? `You have reached the resend limit. Please wait ${formatWaitLabel(resendCountdown)} before starting recovery again.`
        : resendCountdown > 0
          ? `${otpNotice} You can resend in ${resendCountdown}s.`
          : `${otpNotice} You can request another code now.`
      : null;

  const handleSearch = async () => {
    setError(null);
    resetOtpNotice();
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError('Please enter your phone number.');
      return;
    }
    if (looksLikePhoneMissingCode(trimmed)) {
      setError('Please include country code (e.g. +1 555 123 4567).');
      return;
    }
    if (!isPhone(trimmed)) {
      setError('Please enter a valid phone number.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetch<{ accounts: Array<{ id: string }> }>('/auth/identifier-accounts', {
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
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setIsLoading(true);

    try {
      await apiFetch('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          otp: otp.trim(),
          purpose: 'IDENTIFIER_RECOVERY',
        }),
      });
      router.push(
        `/signup?identifier=${encodeURIComponent(identifier.trim())}&step=phone-accounts&from=forgot-id`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PublicShell hideHeader className="login-shell">
      <AuthSplitLayout
        intro={
          <>
            <strong>Recover Account</strong>, verify with your phone.
          </>
        }
        frameClassName="login-frame-grow"
      >
        <form className="login-form-inner" onSubmit={(event) => event.preventDefault()} noValidate>
          {step === 'search' ? (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="forgot-id-identifier">
                Phone number
              </label>
              <input
                id="forgot-id-identifier"
                className="login-input"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Phone number"
                required
              />
            </div>
          ) : (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="forgot-id-otp">
                OTP
              </label>
              <input
                id="forgot-id-otp"
                className="login-input"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="Enter OTP"
                required
              />
            </div>
          )}

          {error ? (
            <div className="login-inline-alert" role="status">
              <span>{error}</span>
              <button
                className="login-inline-close"
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss"
              >
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

          {error ? null : (
            <p className="login-private">
              {step === 'search'
                ? 'Enter the phone number linked to your account.'
                : 'Enter the OTP sent to your phone.'}
              {step === 'otp' ? (
                resendCountdown === 0 && resendAttempts < OTP_MAX_RESENDS ? (
                  <button
                    className="login-link emphasis"
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch('/auth/send-otp', {
                          method: 'POST',
                          body: JSON.stringify({ identifier: identifier.trim(), purpose: 'IDENTIFIER_RECOVERY' }),
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
                ) : null
              ) : null}
            </p>
          )}

          <div className="login-actions">
            {step === 'search' ? (
              <Link className="login-link emphasis" href="/login">
                Login
              </Link>
            ) : (
              <button
                className="login-link emphasis"
                type="button"
                onClick={() => {
                  resetOtpNotice();
                  setStep('search');
                }}
              >
                Back
              </button>
            )}

            {step === 'search' ? (
              <button className="login-button" type="button" onClick={handleSearch} disabled={isLoading}>
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            ) : (
              <button className="login-button" type="button" onClick={() => void handleVerify()} disabled={isLoading}>
                {isLoading ? 'Verifying...' : 'Submit'}
              </button>
            )}
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}
