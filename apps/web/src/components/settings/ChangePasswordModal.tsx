'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api';
import { Button, Modal } from '../ui';

type ChangePasswordStep = 'verify' | 'update';

export function ChangePasswordModal({
  open,
  onClose,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onToast: (message: string, tone: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  const [step, setStep] = useState<ChangePasswordStep>('verify');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep('verify');
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
    }
  }, [open]);

  const continueToUpdate = (event: FormEvent) => {
    event.preventDefault();
    if (currentPassword.trim().length < 8) {
      onToast('Current password looks too short.', 'warning');
      return;
    }
    setStep('update');
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();

    if (nextPassword.trim().length < 8) {
      onToast('New password must be at least 8 characters.', 'warning');
      return;
    }

    if (nextPassword !== confirmPassword) {
      onToast('Passwords do not match.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      await apiFetch('/me/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword,
          nextPassword,
        }),
      });
      onToast('Password updated.', 'success');
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Unable to update password.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      subtitle="Verify your current password, then set a new one."
      panelClassName="settings-password-modal"
    >
      {step === 'verify' ? (
        <form className="stack" onSubmit={continueToUpdate}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </label>
          <div className="ui-inline-form-row ui-inline-form-row--start settings-password-actions">
            <Button type="submit" variant="primary">
              Continue
            </Button>
            <Button href="/forgot-password" variant="ghost">
              Forgot password?
            </Button>
          </div>
        </form>
      ) : (
        <form className="stack" onSubmit={updatePassword}>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <div className="ui-inline-form-row ui-inline-form-row--start settings-password-actions">
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? 'Updating...' : 'Update password'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep('verify')}
              disabled={isSaving}
            >
              Back
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
