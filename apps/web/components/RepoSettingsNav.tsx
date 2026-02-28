import Link from 'next/link';

export function RepoSettingsNav({
  workspaceId,
  repoId,
  active,
}: {
  workspaceId: string;
  repoId: string;
  active: 'general' | 'labels' | 'branches' | 'danger';
}) {
  return (
    <nav className="settings-nav">
      <Link
        className={active === 'general' ? 'active' : undefined}
        href={`/workspaces/${workspaceId}/repos/${repoId}/settings`}
      >
        General
      </Link>
      <Link
        className={active === 'labels' ? 'active' : undefined}
        href={`/workspaces/${workspaceId}/repos/${repoId}/settings/labels`}
      >
        Labels
      </Link>
      <Link
        className={active === 'branches' ? 'active' : undefined}
        href={`/workspaces/${workspaceId}/repos/${repoId}/settings/branches`}
      >
        Branches
      </Link>
      <Link
        className={active === 'danger' ? 'active' : undefined}
        href={`/workspaces/${workspaceId}/repos/${repoId}/settings/danger`}
      >
        Danger zone
      </Link>
    </nav>
  );
}

