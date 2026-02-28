'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './AppShell';
import { apiFetch } from '../lib/api';
import { getToken } from '../lib/auth';
import {
  PortalEmptyState,
  PortalList,
  PortalPage,
  PortalRow,
  PortalToolbar,
} from './portal';
import { PortalToast } from './PortalToast';
import { Badge, Button, EmptyState, SectionHeader } from '../src/components/ui';

type NotificationTab = 'inbox' | 'mentions' | 'invites' | 'system';
type BackendNotificationTab = 'inbox' | 'mentions' | 'reviews' | 'system';

type NotificationItem = {
  id: string;
  type:
    | 'MENTION'
    | 'REVIEW_REQUESTED'
    | 'REVIEW_SUBMITTED'
    | 'ISSUE_COMMENT'
    | 'PULL_COMMENT'
    | 'PULL_STATUS'
    | 'INVITE'
    | 'SYSTEM';
  title: string;
  body?: string | null;
  workspaceId?: string | null;
  repoId?: string | null;
  issueId?: string | null;
  pullRequestId?: string | null;
  readAt?: string | null;
  createdAt: string;
  actor?: {
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  } | null;
};

type NotificationsResponse = {
  notifications: NotificationItem[];
  unread: {
    inbox: number;
    mentions: number;
    reviews: number;
    system: number;
  };
};

type UnreadSummary = {
  inbox: number;
  mentions: number;
  reviews: number;
  system: number;
  invites: number;
};

const tabLabels: Record<NotificationTab, string> = {
  inbox: 'Inbox',
  mentions: 'Mentions',
  invites: 'Invites',
  system: 'System',
};

function mapToBackendTab(tab: NotificationTab): BackendNotificationTab {
  if (tab === 'invites') {
    return 'inbox';
  }
  return tab;
}

function getNotificationLink(item: NotificationItem): string | null {
  if (item.type === 'INVITE') {
    return '/invites';
  }
  const workspaceId = item.workspaceId;
  if (workspaceId && item.repoId) {
    if (item.pullRequestId) {
      return `/workspaces/${workspaceId}/repos/${item.repoId}/pulls/${item.pullRequestId}`;
    }
    if (item.issueId) {
      return `/workspaces/${workspaceId}/repos/${item.repoId}/issues/${item.issueId}`;
    }
    return `/workspaces/${workspaceId}/repos/${item.repoId}`;
  }
  if (workspaceId) {
    return `/workspaces/${workspaceId}`;
  }
  return null;
}

function getNotificationGroup(item: NotificationItem) {
  if (item.workspaceId && item.repoId) {
    return {
      key: `repo:${item.workspaceId}:${item.repoId}`,
      label: `Repository ${item.workspaceId}/${item.repoId}`,
    };
  }
  if (item.workspaceId) {
    return {
      key: `workspace:${item.workspaceId}`,
      label: `Workspace ${item.workspaceId}`,
    };
  }
  if (item.type === 'SYSTEM') {
    return { key: 'system', label: 'System' };
  }
  return { key: 'general', label: 'General' };
}

export function NotificationsCenter({ tab }: { tab: NotificationTab }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState<UnreadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingId, setIsMarkingId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const loadUnreadSummary = useCallback(async () => {
    if (!hasToken) {
      setUnread(null);
      return;
    }

    try {
      const data = await apiFetch<NotificationsResponse>(
        '/me/notifications?tab=inbox&status=unread&limit=100',
      );
      const invites = data.notifications.filter((item) => item.type === 'INVITE').length;
      setUnread({
        ...data.unread,
        invites,
      });
    } catch {
      // keep notification center usable even if unread summary fails
    }
  }, [hasToken]);

  const loadNotifications = useCallback(async () => {
    if (!hasToken) {
      setNotifications([]);
      setUnread(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const backendTab = mapToBackendTab(tab);
      const data = await apiFetch<NotificationsResponse>(
        `/me/notifications?tab=${backendTab}&limit=50`,
      );

      const scopedNotifications =
        tab === 'invites'
          ? data.notifications.filter((item) => item.type === 'INVITE')
          : data.notifications;

      setNotifications(scopedNotifications);
      await loadUnreadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [hasToken, loadUnreadSummary, tab]);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const markNotificationRead = async (id: string, read: boolean) => {
    setIsMarkingId(id);
    setError(null);
    try {
      await apiFetch<{ notification: { id: string; readAt: string | null } }>(
        `/me/notifications/${id}/read`,
        {
          method: 'POST',
          body: JSON.stringify({ read }),
        },
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id
            ? { ...notification, readAt: read ? new Date().toISOString() : null }
            : notification,
        ),
      );
      await loadUnreadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update notification.');
    } finally {
      setIsMarkingId((current) => (current === id ? null : current));
    }
  };

  const markAllAsRead = async () => {
    setIsMarkingAll(true);
    setError(null);

    try {
      if (tab === 'invites') {
        const unreadIds = notifications.filter((item) => !item.readAt).map((item) => item.id);
        await Promise.all(
          unreadIds.map((id) =>
            apiFetch(`/me/notifications/${id}/read`, {
              method: 'POST',
              body: JSON.stringify({ read: true }),
            }),
          ),
        );
      } else {
        const backendTab = mapToBackendTab(tab);
        await apiFetch<{ updated: number }>('/me/notifications/read-all', {
          method: 'POST',
          body: JSON.stringify({ tab: backendTab }),
        });
      }
      await loadNotifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark all as read.');
    } finally {
      setIsMarkingAll(false);
    }
  };

  const visibleNotifications = useMemo(
    () =>
      [...notifications]
        .filter((item) => (showUnreadOnly ? !item.readAt : true))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notifications, showUnreadOnly],
  );

  const groupedNotifications = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: NotificationItem[] }>();

    for (const item of visibleNotifications) {
      const group = getNotificationGroup(item);
      const existing = map.get(group.key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(group.key, { key: group.key, label: group.label, items: [item] });
      }
    }

    return Array.from(map.values());
  }, [visibleNotifications]);

  const unreadSummary = unread
    ? `${unread.inbox} inbox, ${unread.mentions} mentions, ${unread.reviews} reviews, ${unread.invites} invites, ${unread.system} system`
    : null;

  return (
    <AppShell title={`Notifications - ${tabLabels[tab]}`}>
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      <PortalPage className="notifications-shell">
        <PortalToolbar
          title={tabLabels[tab]}
          subtitle="Notifications from workspaces and repositories."
          actions={
            <>
              <Button
                className={`inbox-action ${showUnreadOnly ? 'active' : ''}`.trim()}
                variant={showUnreadOnly ? 'primary' : 'secondary'}
                type="button"
                onClick={() => setShowUnreadOnly((current) => !current)}
                disabled={!hasToken}
              >
                {showUnreadOnly ? 'Showing unread' : 'Show unread only'}
              </Button>
              <Button
                className="inbox-action"
                variant="secondary"
                type="button"
                onClick={() => void markAllAsRead()}
                disabled={!hasToken || isMarkingAll || !visibleNotifications.some((item) => !item.readAt)}
              >
                {isMarkingAll ? 'Marking...' : 'Mark all as read'}
              </Button>
            </>
          }
        >
          {unreadSummary ? <p className="canvas-subtitle">Unread: {unreadSummary}</p> : null}
        </PortalToolbar>

        <PortalList>
          {!hasToken ? (
            <PortalEmptyState message="Sign in to view your notification feed." />
          ) : isLoading ? (
            <p className="muted inbox-state">Loading notifications...</p>
          ) : groupedNotifications.length ? (
            <div className="notifications-groups">
              {groupedNotifications.map((group) => (
                <section key={group.key} className="notifications-group">
                  <SectionHeader
                    className="notifications-group-head"
                    title={group.label}
                    actions={<Badge tone="accent">{group.items.length}</Badge>}
                  />
                  <ul className="list">
                    {group.items.map((item) => {
                      const actorName =
                        item.actor?.name ?? item.actor?.username ?? item.actor?.email ?? 'System';
                      const destination = getNotificationLink(item);
                      return (
                        <PortalRow
                          key={item.id}
                          className={`notification-item ${item.readAt ? '' : 'unread'}`.trim()}
                        >
                          <div className="queue-main">
                            <div className="queue-content">
                              <strong>{item.title}</strong>
                              <span className="muted">
                                {actorName} - {new Date(item.createdAt).toLocaleString()}
                              </span>
                              {item.body ? <p className="muted">{item.body}</p> : null}
                            </div>
                            <div className="queue-actions">
                              {destination ? (
                                <Button
                                  href={destination}
                                  variant="primary"
                                  size="sm"
                                  onClick={() => {
                                    if (!item.readAt) {
                                      void markNotificationRead(item.id, true);
                                    }
                                  }}
                                >
                                  Open
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => void markNotificationRead(item.id, !item.readAt)}
                                disabled={isMarkingId === item.id}
                              >
                                {isMarkingId === item.id
                                  ? 'Saving...'
                                  : item.readAt
                                    ? 'Mark unread'
                                    : 'Mark read'}
                              </Button>
                            </div>
                          </div>
                        </PortalRow>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState title="No items in this feed yet." />
          )}
        </PortalList>
      </PortalPage>
    </AppShell>
  );
}

