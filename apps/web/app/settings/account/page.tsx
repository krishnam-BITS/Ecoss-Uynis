'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { PortalToast } from '../../../components/PortalToast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineFormRow,
  SectionHeader,
} from '../../../src/components/ui';
import { ChangePasswordModal } from '../../../src/components/settings/ChangePasswordModal';

type PrivateAccount = {
  id: string;
  status: string;
  expiresAt: string;
  isEmailVerified?: boolean | null;
  isPhoneVerified?: boolean | null;
};

type MeUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  username?: string | null;
  createdAt: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  privateAccount?: PrivateAccount | null;
};

type SessionItem = {
  id: string;
  tokenId: string;
  createdAt: string;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type SessionsResponse = {
  currentTokenId: string | null;
  sessions: SessionItem[];
};

type NotificationPreferences = {
  id: string;
  userId: string;
  inAppActivityEnabled: boolean;
  mentionsEnabled: boolean;
  reviewRequestsEnabled: boolean;
  reviewSubmittedEnabled: boolean;
  issueCommentsEnabled: boolean;
  pullCommentsEnabled: boolean;
  pullStatusEnabled: boolean;
  systemEnabled: boolean;
  emailMentionsEnabled: boolean;
  emailReviewsEnabled: boolean;
  productUpdatesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type PreferenceKey = keyof Omit<
  NotificationPreferences,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>;

type Tone = 'success' | 'error' | 'warning' | 'info';

const preferenceItems: Array<{ key: PreferenceKey; label: string; description: string }> = [
  {
    key: 'inAppActivityEnabled',
    label: 'In-app activity feed',
    description: 'Master switch for notification feed activity.',
  },
  {
    key: 'mentionsEnabled',
    label: 'Mentions',
    description: 'Get notified when someone tags your username.',
  },
  {
    key: 'reviewRequestsEnabled',
    label: 'Review requests',
    description: 'Receive alerts when review is requested.',
  },
  {
    key: 'issueCommentsEnabled',
    label: 'Issue comments',
    description: 'Receive updates for issue comment activity.',
  },
  {
    key: 'pullCommentsEnabled',
    label: 'Pull request comments',
    description: 'Receive updates for pull request conversations.',
  },
  {
    key: 'systemEnabled',
    label: 'System notices',
    description: 'Receive platform-wide and admin notifications.',
  },
  {
    key: 'emailMentionsEnabled',
    label: 'Email for mentions',
    description: 'Send mention alerts to your email.',
  },
  {
    key: 'emailReviewsEnabled',
    label: 'Email for reviews',
    description: 'Send review request alerts to your email.',
  },
  {
    key: 'productUpdatesEnabled',
    label: 'Product updates',
    description: 'Receive occasional product update announcements.',
  },
];

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Not available';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not available';
  }
  return parsed.toLocaleString();
};

const describeUserAgent = (value?: string | null) => {
  if (!value) {
    return 'Unknown client';
  }
  if (value.length > 80) {
    return `${value.slice(0, 80)}...`;
  }
  return value;
};

export default function AccountSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<MeUser | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentTokenId, setCurrentTokenId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [savingPreferenceKey, setSavingPreferenceKey] = useState<PreferenceKey | null>(null);
  const [showSessionHistory, setShowSessionHistory] = useState(false);

  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const modalParam = (searchParams.get('modal') ?? '').toLowerCase();

  const notify = (message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [meData, sessionsData, preferencesData] = await Promise.all([
        apiFetch<{ user: MeUser }>('/me'),
        apiFetch<SessionsResponse>('/me/sessions'),
        apiFetch<{ preferences: NotificationPreferences }>('/me/notification-preferences'),
      ]);
      setUser(meData.user);
      setSessions(sessionsData.sessions);
      setCurrentTokenId(sessionsData.currentTokenId);
      setPreferences(preferencesData.preferences);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load account settings.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setIsPasswordModalOpen(modalParam === 'password');
  }, [modalParam]);

  const closePasswordModal = useCallback(() => {
    setIsPasswordModalOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    next.delete('modal');
    const query = next.toString();
    router.replace(query ? `/settings/account?${query}` : '/settings/account');
  }, [router, searchParams]);

  const openPasswordModal = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('modal', 'password');
    router.replace(`/settings/account?${next.toString()}`);
  }, [router, searchParams]);

  const twoFactorStatus = useMemo(() => {
    const hasVerifiedFactor = Boolean(
      user?.emailVerified ||
        user?.phoneVerified ||
        user?.privateAccount?.isEmailVerified ||
        user?.privateAccount?.isPhoneVerified,
    );

    if (hasVerifiedFactor) {
      return {
        label: 'Partially enabled',
        tone: 'success' as const,
        detail: 'Verified contact factor available. Dedicated 2FA enrollment is not exposed yet.',
      };
    }

    return {
      label: 'Not configured',
      tone: 'warning' as const,
      detail: 'Add and verify email/phone to improve account recovery and challenge readiness.',
    };
  }, [
    user?.emailVerified,
    user?.phoneVerified,
    user?.privateAccount?.isEmailVerified,
    user?.privateAccount?.isPhoneVerified,
  ]);

  const currentSessionId = useMemo(() => {
    const byToken =
      currentTokenId
        ? sessions.find((session) => session.tokenId === currentTokenId && !session.revokedAt)?.id
        : null;
    if (byToken) {
      return byToken;
    }
    return null;
  }, [currentTokenId, sessions]);

  function isSessionExpired(session: SessionItem) {
    if (!session.expiresAt || session.revokedAt) {
      return false;
    }
    const expiry = new Date(session.expiresAt).getTime();
    return Number.isFinite(expiry) && expiry <= Date.now();
  }

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );

  const isLikelySupersededSession = useCallback((session: SessionItem) => {
    if (!currentSession || session.id === currentSession.id) {
      return false;
    }
    if (session.revokedAt || isSessionExpired(session)) {
      return false;
    }
    return (
      Boolean(session.userAgent) &&
      Boolean(currentSession.userAgent) &&
      session.userAgent === currentSession.userAgent &&
      (session.ipAddress ?? '') === (currentSession.ipAddress ?? '')
    );
  }, [currentSession]);

  const orderedSessions = useMemo(() => {
    const scoreSession = (session: SessionItem) => {
      const isCurrent = session.id === currentSessionId;
      const isRevoked = Boolean(session.revokedAt);
      const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
      const created = session.createdAt ? new Date(session.createdAt).getTime() : 0;
      const activity = Math.max(lastSeen, created);
      if (isCurrent) {
        return { bucket: 0, activity };
      }
      if (!isRevoked && !isSessionExpired(session)) {
        return { bucket: 1, activity };
      }
      return { bucket: 2, activity };
    };

    return [...sessions].sort((left, right) => {
      const leftScore = scoreSession(left);
      const rightScore = scoreSession(right);
      if (leftScore.bucket !== rightScore.bucket) {
        return leftScore.bucket - rightScore.bucket;
      }
      return rightScore.activity - leftScore.activity;
    });
  }, [currentSessionId, sessions]);

  const activeSessions = useMemo(
    () =>
      orderedSessions.filter(
        (session) => !session.revokedAt && !isSessionExpired(session) && !isLikelySupersededSession(session),
      ),
    [isLikelySupersededSession, orderedSessions],
  );

  const archivedSessions = useMemo(
    () =>
      orderedSessions.filter(
        (session) => Boolean(session.revokedAt) || isSessionExpired(session) || isLikelySupersededSession(session),
      ),
    [isLikelySupersededSession, orderedSessions],
  );

  const revokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    try {
      await apiFetch<{ revoked: boolean; currentSessionRevoked: boolean }>(`/me/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, revokedAt: new Date().toISOString() } : session,
        ),
      );
      notify('Session revoked.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to revoke session.', 'error');
    } finally {
      setRevokingSessionId((current) => (current === sessionId ? null : current));
    }
  };

  const revokeOtherSessions = async () => {
    setIsRevokingOthers(true);
    try {
      const data = await apiFetch<{ revoked: number }>('/me/sessions/revoke-others', {
        method: 'POST',
      });
      notify(`Revoked ${data.revoked} other session${data.revoked === 1 ? '' : 's'}.`, 'success');
      await loadData();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to revoke other sessions.', 'error');
    } finally {
      setIsRevokingOthers(false);
    }
  };

  const setPreference = async (key: PreferenceKey, value: boolean) => {
    if (!preferences) {
      return;
    }

    const previous = preferences;
    setPreferences({ ...previous, [key]: value });
    setSavingPreferenceKey(key);

    try {
      const data = await apiFetch<{ preferences: NotificationPreferences }>('/me/notification-preferences', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      setPreferences(data.preferences);
      notify('Notification preference updated.', 'success');
    } catch (error) {
      setPreferences(previous);
      notify(error instanceof Error ? error.message : 'Unable to update notification preference.', 'error');
    } finally {
      setSavingPreferenceKey((current) => (current === key ? null : current));
    }
  };

  return (
    <div className="portal-container portal-stack settings-account-shell">
      {toast ? (
        <PortalToast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}

      <Card className="settings-account-card portal-card">
        <SectionHeader
          title="Account overview"
          subtitle="Profile metadata and identity health."
          actions={
            <Button href="/settings/profile" variant="ghost">
              Edit profile
            </Button>
          }
        />

        {isLoading && !user ? (
          <p className="muted">Loading account...</p>
        ) : user ? (
          <div className="settings-account-meta-grid">
            <article className="settings-account-meta-item">
              <span>Email</span>
              <strong>{user.email ?? 'Not added'}</strong>
            </article>
            <article className="settings-account-meta-item">
              <span>Phone</span>
              <strong>{user.phone ?? 'Not added'}</strong>
            </article>
            <article className="settings-account-meta-item">
              <span>Username</span>
              <strong>{user.username ? `@${user.username}` : 'Not added'}</strong>
            </article>
            <article className="settings-account-meta-item">
              <span>Member since</span>
              <strong>{formatDateTime(user.createdAt)}</strong>
            </article>
          </div>
        ) : (
          <p className="muted">Account metadata could not be loaded.</p>
        )}
      </Card>

      <Card className="settings-account-card portal-card">
        <SectionHeader
          title="Security"
          actions={
            <Button variant="ghost" type="button" onClick={openPasswordModal}>
              Change password
            </Button>
          }
        />

        <div className="settings-security-status-row">
          <Badge className={`settings-security-badge is-${twoFactorStatus.tone}`} tone={twoFactorStatus.tone === 'success' ? 'success' : 'warning'}>
            2FA: {twoFactorStatus.label}
          </Badge>
          <p className="muted">{twoFactorStatus.detail}</p>
        </div>

        <div className="stack settings-session-list-shell">
          <SectionHeader
            className="settings-session-list-head"
            title="Open sessions"
            subtitle="Only sessions that still look live stay here. Older sign-ins from the same device move to history."
            actions={
              <InlineFormRow align="center" className="settings-session-head-actions">
                {archivedSessions.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setShowSessionHistory((value) => !value)}
                  >
                    {showSessionHistory
                      ? 'Hide history'
                      : `Show history (${archivedSessions.length})`}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void revokeOtherSessions()}
                  disabled={isRevokingOthers}
                >
                  {isRevokingOthers ? 'Revoking...' : 'Revoke other sessions'}
                </Button>
              </InlineFormRow>
            }
          />

          {activeSessions.length ? (
            <ul className="settings-session-list">
              {activeSessions.map((session) => {
                const isCurrent = session.id === currentSessionId;
                const isRevoked = Boolean(session.revokedAt);
                const isExpired = isSessionExpired(session);
                return (
                  <li key={session.id} className="settings-session-row">
                    <div className="settings-session-main">
                      <div className="settings-session-heading">
                        <strong>{isCurrent ? 'Current session' : 'Session'}</strong>
                        <Badge
                          className={`settings-session-state ${isRevoked ? 'is-revoked' : isCurrent ? 'is-current' : ''}`}
                          tone={isRevoked || isExpired ? 'warning' : isCurrent ? 'accent' : 'success'}
                          size="sm"
                        >
                          {isRevoked ? 'Revoked' : isExpired ? 'Expired' : isCurrent ? 'Current' : 'Active'}
                        </Badge>
                      </div>
                      <p className="muted">{describeUserAgent(session.userAgent)}</p>
                      <p className="muted">
                        IP: {session.ipAddress ?? 'Unknown'} | Last seen: {formatDateTime(session.lastSeenAt)} | Expires: {formatDateTime(session.expiresAt)}
                      </p>
                    </div>
                    <InlineFormRow align="center" className="settings-session-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => void revokeSession(session.id)}
                        disabled={isRevoked || isExpired || revokingSessionId === session.id || isCurrent}
                        aria-label={`Revoke session ${session.id}`}
                      >
                        {revokingSessionId === session.id
                          ? 'Revoking...'
                          : isRevoked
                            ? 'Revoked'
                            : isExpired
                              ? 'Expired'
                              : isCurrent
                                ? 'Current'
                                : 'Revoke'}
                      </Button>
                    </InlineFormRow>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No active sessions found." description="Active and current sessions will appear here." />
          )}

          {showSessionHistory && archivedSessions.length ? (
            <div className="settings-session-history">
              <p className="muted settings-session-history-note">
                Session history is retained for security auditing.
              </p>
              <ul className="settings-session-list settings-session-list--history">
                {archivedSessions.map((session) => {
                  const isRevoked = Boolean(session.revokedAt);
                  const isExpired = isSessionExpired(session);
                  const isSuperseded = isLikelySupersededSession(session);
                  return (
                    <li key={session.id} className="settings-session-row settings-session-row--history">
                      <div className="settings-session-main">
                        <div className="settings-session-heading">
                          <strong>Session</strong>
                          <Badge
                            className={`settings-session-state ${isRevoked ? 'is-revoked' : ''}`}
                            tone={isRevoked || isExpired ? 'warning' : 'success'}
                            size="sm"
                          >
                            {isRevoked ? 'Revoked' : isExpired ? 'Expired' : isSuperseded ? 'Previous login' : 'Archived'}
                          </Badge>
                        </div>
                        <p className="muted">{describeUserAgent(session.userAgent)}</p>
                        <p className="muted">
                          IP: {session.ipAddress ?? 'Unknown'} | Last seen: {formatDateTime(session.lastSeenAt)} | Expires: {formatDateTime(session.expiresAt)}
                        </p>
                      </div>
                      <InlineFormRow align="center" className="settings-session-actions">
                        <Button variant="ghost" size="sm" type="button" disabled>
                          {isSuperseded ? 'Closed' : 'Archived'}
                        </Button>
                      </InlineFormRow>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="settings-account-card portal-card">
        <SectionHeader
          title="Global notification preferences"
          subtitle="Choose what appears in your personal feed and alerts."
          actions={
            <Button href="/notifications/manage" variant="ghost">
              Repo overrides
            </Button>
          }
        />

        {preferences ? (
          <div className="settings-preference-list">
            {preferenceItems.map((item) => (
              <label key={item.key} className="toggle-row settings-preference-item">
                <span>
                  <strong>{item.label}</strong>
                  <small className="muted">{item.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences[item.key]}
                  onChange={(event) => void setPreference(item.key, event.target.checked)}
                  disabled={savingPreferenceKey === item.key}
                  aria-label={item.label}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">Notification preferences could not be loaded.</p>
        )}
      </Card>

      <ChangePasswordModal
        open={isPasswordModalOpen}
        onClose={closePasswordModal}
        onToast={notify}
      />
    </div>
  );
}

