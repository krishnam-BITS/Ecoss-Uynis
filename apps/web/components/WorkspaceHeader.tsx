'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type WorkspaceHeaderProps = {
  workspaceId: string;
  workspace: {
    name?: string;
    slug?: string;
    isPersonal?: boolean;
    viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  } | null;
};

export function WorkspaceHeader({
  workspaceId,
  workspace,
}: WorkspaceHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceSlug = workspace?.slug ?? workspaceId;
  const workspaceName = workspace?.name ?? 'Workspace';
  const scopeLabel = workspace?.isPersonal ? 'Personal' : 'Team';
  const roleLabel = workspace?.viewerRole ?? 'MEMBER';
  const queryString = searchParams.toString();

  useEffect(() => {
    if (!workspace?.slug) {
      return;
    }
    const match = pathname.match(/^\/workspaces\/([^/]+)(?!\/repos)(\/.*)?$/);
    if (!match) {
      return;
    }
    const pathWorkspaceRef = match[1];
    const suffix = match[2] ?? '';
    if (pathWorkspaceRef === workspace.slug) {
      return;
    }
    router.replace(
      `/workspaces/${workspace.slug}${suffix}${queryString ? `?${queryString}` : ''}`,
    );
  }, [pathname, queryString, router, workspace?.slug]);

  return (
    <section className="workspace-header">
      <div className="workspace-header-meta">
        <p className="workspace-path">
          <Link href="/workspaces">Workspaces</Link>
          <span>/</span>
          <span>{workspaceSlug}</span>
        </p>
        <h2 className="workspace-title">{workspaceName}</h2>
        <div className="workspace-header-pills" aria-label="Workspace metadata">
          <span className="workspace-header-pill">{scopeLabel}</span>
          <span className="workspace-header-pill">{roleLabel}</span>
        </div>
      </div>
    </section>
  );
}
