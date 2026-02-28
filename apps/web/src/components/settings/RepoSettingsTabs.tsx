'use client';

import { Tabs } from '../ui';

export type RepoSettingsTabKey = 'general' | 'access' | 'webhooks' | 'pats' | 'danger';

const tabLabels: Array<{ key: RepoSettingsTabKey; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'access', label: 'Access' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'pats', label: 'Personal Access Tokens' },
  { key: 'danger', label: 'Danger zone' },
];

export function RepoSettingsTabs({
  activeTab,
  onChange,
  includeDanger = true,
}: {
  activeTab: RepoSettingsTabKey;
  onChange: (tab: RepoSettingsTabKey) => void;
  includeDanger?: boolean;
}) {
  const tabs = includeDanger ? tabLabels : tabLabels.filter((tab) => tab.key !== 'danger');

  return (
    <Tabs
      items={tabs}
      activeKey={activeTab}
      onChange={onChange}
      ariaLabel="Repository settings sections"
      className="repo-settings-tabs"
    />
  );
}
