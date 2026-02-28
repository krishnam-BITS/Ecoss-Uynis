'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../../components/AppShell';
import { apiFetch } from '../../../lib/api';
import { clearToken, getToken } from '../../../lib/auth';

type PrivateAccount = {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  lastLoginAt: string;
};

type MeUser = {
  id: string;
  username?: string | null;
  email?: string | null;
  privateAccount?: PrivateAccount | null;
};

export default function PrivateDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'archive' | 'delete' | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: MeUser }>('/me');
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load private account.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/private');
      return;
    }
    void load();
  }, [router]);

  const daysUntilExpiry = useMemo(() => {
    if (!user?.privateAccount?.expiresAt) {
      return null;
    }
    const expires = new Date(user.privateAccount.expiresAt).getTime();
    const now = Date.now();
    return Math.max(0, Math.ceil((expires - now) / (24 * 60 * 60 * 1000)));
  }, [user?.privateAccount?.expiresAt]);

  const handleDownloadData = () => {
    if (!user?.privateAccount) {
      return;
    }
    const payload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      privateAccount: user.privateAccount,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `private-account-${user.username ?? user.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Account snapshot downloaded.');
  };

  const handleArchive = async () => {
    if (!confirm('Archive this private account? You can recover it using your phrase.')) {
      return;
    }
    setActionLoading('archive');
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/auth/private/archive', { method: 'POST' });
      await load();
      setMessage('Private account archived.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive account.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this private account? This action cannot be undone.')) {
      return;
    }
    setActionLoading('delete');
    setError(null);
    setMessage(null);
    try {
      await apiFetch('/auth/private/delete', { method: 'POST' });
      clearToken();
      window.location.assign('/private');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account.');
      setActionLoading(null);
    }
  };

  return (
    <AppShell title="Private Account">
      <div className="stack">
        <section className="card stack">
          <div className="row space-between">
            <h2>Private account dashboard</h2>
            <Link className="ghost" href="/private/recover">
              Recovery
            </Link>
          </div>
          <p className="muted">
            Private accounts are anonymous. Keep your username, password, and recovery phrase safe.
          </p>
        </section>

        {isLoading ? (
          <section className="card">
            <p className="muted">Loading private account...</p>
          </section>
        ) : null}

        {!isLoading && user?.privateAccount ? (
          <section className="card stack">
            <h2>Account status</h2>
            <div className="meta">
              <div>
                <span className="muted">Username</span>
                <strong>{user.username ?? 'Not available'}</strong>
              </div>
              <div>
                <span className="muted">Status</span>
                <strong>{user.privateAccount.status}</strong>
              </div>
              <div>
                <span className="muted">Created</span>
                <strong>{new Date(user.privateAccount.createdAt).toLocaleDateString()}</strong>
              </div>
              <div>
                <span className="muted">Last login</span>
                <strong>{new Date(user.privateAccount.lastLoginAt).toLocaleDateString()}</strong>
              </div>
              <div>
                <span className="muted">Expires</span>
                <strong>{new Date(user.privateAccount.expiresAt).toLocaleDateString()}</strong>
              </div>
              <div>
                <span className="muted">Days left</span>
                <strong>{daysUntilExpiry ?? 'N/A'}</strong>
              </div>
            </div>

            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="ghost" type="button" onClick={handleDownloadData}>
                Download account data
              </button>
              <button
                className="ghost"
                type="button"
                onClick={handleArchive}
                disabled={actionLoading !== null || user.privateAccount.status !== 'ACTIVE'}
              >
                {actionLoading === 'archive' ? 'Archiving...' : 'Archive account'}
              </button>
              <button
                className="danger"
                type="button"
                onClick={handleDelete}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'delete' ? 'Deleting...' : 'Delete account'}
              </button>
            </div>
          </section>
        ) : null}

        {!isLoading && !user?.privateAccount ? (
          <section className="card stack">
            <h2>No private account found</h2>
            <p className="muted">Create one from private mode.</p>
            <Link className="primary small" href="/private">
              Go to private mode
            </Link>
          </section>
        ) : null}

        {message ? (
          <section className="card">
            <p className="muted">{message}</p>
          </section>
        ) : null}

        {error ? (
          <section className="card">
            <p className="error">{error}</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

