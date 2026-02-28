'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '../../../components/PublicShell';
import { AuthSplitLayout } from '../../../components/AuthSplitLayout';
import { apiFetch } from '../../../lib/api';
import { setToken } from '../../../lib/auth';

type RecoveryStep = 'phrase' | 'password' | 'success';

type VerifiedRecovery = {
  accountId: string;
  username: string;
  userId: string;
  status: string;
};

export default function PrivateRecoverPage() {
  const [step, setStep] = useState<RecoveryStep>('phrase');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verifiedAccount, setVerifiedAccount] = useState<VerifiedRecovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerifyPhrase = async () => {
    setError(null);
    if (!recoveryPhrase.trim()) {
      setError('Please enter your recovery phrase.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetch<VerifiedRecovery>('/auth/verify-recovery-phrase', {
        method: 'POST',
        body: JSON.stringify({ recoveryPhrase: recoveryPhrase.trim() }),
      });
      setVerifiedAccount(data);
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid recovery phrase.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPassword = async () => {
    setError(null);
    if (!newPassword.trim()) {
      setError('Please enter a new password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetch<{ token: string }>('/auth/reset-private-password', {
        method: 'POST',
        body: JSON.stringify({
          recoveryPhrase: recoveryPhrase.trim(),
          newPassword,
        }),
      });
      setToken(data.token);
      setStep('success');
      setTimeout(() => {
        window.location.assign('/private/dashboard');
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PublicShell hideHeader className="login-shell">
      <AuthSplitLayout
        intro={
          <>
            <strong>Private recovery</strong>, restore access with your phrase.
          </>
        }
        frameClassName="login-frame-grow"
      >
        <form className="login-form-inner" onSubmit={(event) => event.preventDefault()} noValidate>
          {step === 'phrase' ? (
            <div className="login-field-group">
              <label className="sr-only" htmlFor="private-recovery-phrase">
                Recovery phrase
              </label>
              <textarea
                id="private-recovery-phrase"
                className="login-input"
                rows={3}
                value={recoveryPhrase}
                onChange={(event) => setRecoveryPhrase(event.target.value)}
                placeholder="Paste your 12-word recovery phrase"
              />
            </div>
          ) : null}

          {step === 'password' ? (
            <>
              <div className="login-field-group">
                <h2 className="login-title">Set new password</h2>
                <p className="login-copy">
                  Account: {verifiedAccount?.username ?? 'Private account'}
                </p>
              </div>
              <div className="login-field-group">
                <label className="sr-only" htmlFor="private-recovery-password">
                  New password
                </label>
                <input
                  id="private-recovery-password"
                  className="login-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password"
                />
              </div>
              <div className="login-field-group">
                <label className="sr-only" htmlFor="private-recovery-confirm-password">
                  Confirm password
                </label>
                <input
                  id="private-recovery-confirm-password"
                  className="login-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm password"
                />
              </div>
            </>
          ) : null}

          {step === 'success' ? (
            <div className="login-field-group">
              <h2 className="login-title">Recovered successfully</h2>
              <p className="login-copy">Redirecting to private dashboard...</p>
            </div>
          ) : null}

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
          ) : null}

          <div className="login-actions">
            {step === 'phrase' ? (
              <Link className="login-link emphasis" href="/private">
                Back
              </Link>
            ) : step === 'password' ? (
              <button className="login-link emphasis" type="button" onClick={() => setStep('phrase')}>
                Back
              </button>
            ) : (
              <span />
            )}

            {step === 'phrase' ? (
              <button className="login-button" type="button" onClick={handleVerifyPhrase} disabled={isLoading}>
                {isLoading ? 'Verifying...' : 'Verify'}
              </button>
            ) : step === 'password' ? (
              <button className="login-button" type="button" onClick={handleSetPassword} disabled={isLoading}>
                {isLoading ? 'Resetting...' : 'Reset password'}
              </button>
            ) : (
              <Link className="login-button" href="/private/dashboard">
                Continue
              </Link>
            )}
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}

