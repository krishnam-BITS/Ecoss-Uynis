'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';
import { PortalCard, PortalPage, PortalToolbar } from '../../../../components/portal';
import { WorkspaceHeader } from '../../../../components/WorkspaceHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { PortalToast } from '../../../../components/PortalToast';
import { getToken } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

export default function WorkspaceSharePage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const workspaceRef = workspace?.slug ?? workspaceId;
  const publicUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/workspaces/${workspaceRef}`;
  }, [workspaceRef]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setError('Sign in is required to manage workspace sharing.');
      return;
    }
    void apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}`, {
      suppressAuthRedirect: true,
    })
      .then((data) => {
        if (!data.workspace) {
          throw new Error('Workspace not found.');
        }
        setWorkspace(data.workspace);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load workspace.');
      });
  }, [workspaceId]);

  const copyShareLink = async () => {
    if (!publicUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      setStatus('Workspace link copied.');
    } catch {
      setError('Unable to copy workspace link.');
    }
  };

  return (
    <AppShell>
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {status ? (
        <PortalToast message={status} tone="success" onClose={() => setStatus(null)} />
      ) : null}
      <WorkspaceHeader workspaceId={workspaceRef} workspace={workspace} />
      {workspace ? (
        <WorkspaceNav
          workspaceId={workspaceRef}
          active="overview"
          viewerRole={workspace.viewerRole}
          isPersonal={workspace.isPersonal}
        />
      ) : null}
      <PortalPage className="workspace-share-shell">
        <PortalToolbar
          title="Share workspace"
          subtitle="Copy the public workspace link."
        />
        <PortalCard className="stack">
          <label className="field">
            <span>Workspace URL</span>
            <input type="text" value={publicUrl} readOnly />
          </label>
          <div className="row">
            <button className="primary small" type="button" onClick={() => void copyShareLink()}>
              Copy link
            </button>
            <Link className="ghost small" href={publicUrl || `/workspaces/${workspaceRef}`}>
              Open public view
            </Link>
          </div>
        </PortalCard>
      </PortalPage>
    </AppShell>
  );
}
