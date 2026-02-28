'use client';

import Link from 'next/link';

export type NotificationNavTab = 'inbox' | 'mentions' | 'invites' | 'system' | 'manage';

type UnreadSummary = {
  inbox: number;
  mentions: number;
  invites: number;
  system: number;
};

const tabs: Array<{ key: NotificationNavTab; label: string; href: string }> = [
  { key: 'inbox', label: 'Inbox', href: '/notifications' },
  { key: 'mentions', label: 'Mentions', href: '/notifications/mentions' },
  { key: 'invites', label: 'Invites', href: '/notifications/invites' },
  { key: 'system', label: 'System', href: '/notifications/system' },
  { key: 'manage', label: 'Manage', href: '/notifications/manage' },
];

const readCountForTab = (
  tab: NotificationNavTab,
  unread: UnreadSummary | null,
): number | null => {
  if (!unread || tab === 'manage') {
    return null;
  }
  return unread[tab];
};

export function NotificationsTabs({
  activeTab,
  unread,
}: {
  activeTab: NotificationNavTab;
  unread?: UnreadSummary | null;
}) {
  const getTabClass = (tab: NotificationNavTab) =>
    `canvas-subtab inbox-tab${activeTab === tab ? ' active' : ''}`;

  return (
    <div
      className="canvas-subnav notifications-tabs"
      role="tablist"
      aria-label="Notification sections"
    >
      {tabs.map((tab) => {
        const count = readCountForTab(tab.key, unread ?? null);
        return (
          <Link
            key={tab.key}
            className={getTabClass(tab.key)}
            href={tab.href}
            role="tab"
            aria-selected={activeTab === tab.key}
          >
            <span>{tab.label}</span>
            {typeof count === 'number' && count > 0 ? (
              <span className="notifications-tab-count" aria-label={`${count} unread`}>
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
