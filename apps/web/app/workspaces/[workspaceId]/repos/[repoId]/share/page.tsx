'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../../../components/AppShell';
import { RepoHeader } from '../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../components/RepoNav';
import { PortalCard, PortalPage } from '../../../../../../components/portal';
import { PortalToast } from '../../../../../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { Button } from '../../../../../../src/components/ui';

type Repo = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  publicReadRequiresAuth?: boolean;
  workspace?: {
    slug?: string;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

export default function RepoSharePage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const [repo, setRepo] = useState<Repo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const workspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;
  const hasToken = Boolean(getToken());

  const repoViewUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/workspaces/${workspaceRef}/repos/${repoRef}`;
  }, [repoRef, workspaceRef]);

  const gitCloneUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    const remoteUrl = new URL(window.location.origin);
    remoteUrl.port = '4001';
    remoteUrl.pathname = `/${workspaceRef}/${repoRef}.git`;
    return remoteUrl.toString();
  }, [repoRef, workspaceRef]);

  useEffect(() => {
    if (!workspaceId || !repoId) {
      return;
    }
    const load = async () => {
      setError(null);
      setAuthRequired(false);
      setForbidden(false);
      try {
        const data = await apiFetch<{ repo: Repo }>(`/workspaces/${workspaceId}/repos/${repoId}`, {
          suppressAuthRedirect: true,
        });
        setRepo(data.repo);
      } catch (nextError) {
        if (nextError instanceof ApiRequestError) {
          if (nextError.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to manage repository sharing.');
            return;
          }
          if (nextError.status === 403) {
            setForbidden(true);
            setError('You do not have access to this repository.');
            return;
          }
        }
        setError(nextError instanceof Error ? nextError.message : 'Unable to load repository.');
      }
    };
    void load();
  }, [repoId, workspaceId]);

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage);
    } catch {
      setError('Unable to copy link to clipboard.');
    }
  };

  if (authRequired) {
    return (
      <AppShell>
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
        <PortalPage className="repo-share-shell">
          <PortalCard className="repo-share-card stack">
            <p className="muted">Sign in to access sharing controls for this repository.</p>
            <Button
              variant="primary"
              size="sm"
              href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceId}/repos/${repoId}/share`)}`}
            >
              Login to continue
            </Button>
          </PortalCard>
        </PortalPage>
      </AppShell>
    );
  }

  if (forbidden) {
    return (
      <AppShell>
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
        <PortalPage className="repo-share-shell">
          <PortalCard className="repo-share-card stack">
            <p className="muted">You are signed in but do not have access to this repository.</p>
            <div className="repo-share-management">
              <Button variant="primary" size="sm" href="/repositories">
                Repositories
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </div>
          </PortalCard>
        </PortalPage>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {status ? <PortalToast message={status} tone="success" onClose={() => setStatus(null)} /> : null}

      <RepoHeader
        workspaceId={workspaceRef}
        repoId={repoRef}
        repo={repo}
        languages={repo?.languages ?? []}
      />
      {repo ? (
        <RepoNav workspaceId={workspaceRef} repoId={repoRef} active="share" viewerRole={repo.viewerRole} />
      ) : null}

      <PortalPage className="repo-share-shell">
        <PortalCard className="repo-share-card">
          <div className="repo-share-grid">
            <article className="repo-share-item">
              <h3>Browse URL</h3>
              <div className="repo-share-link-row">
                <code>{repoViewUrl}</code>
                <div className="repo-share-link-actions">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => void copyText(repoViewUrl, 'Repository URL copied.')}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </article>

            <article className="repo-share-item">
              <h3>Git clone URL</h3>
              <div className="repo-share-link-row">
                <code>{gitCloneUrl}</code>
                <div className="repo-share-link-actions">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => void copyText(gitCloneUrl, 'Clone URL copied.')}
                  >
                    Copy
                  </Button>
                  {hasToken ? null : (
                    <Link
                      className="ghost small"
                      href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceRef}/repos/${repoRef}/share`)}`}
                    >
                      Login to contribute
                    </Link>
                  )}
                </div>
              </div>
            </article>
          </div>
        </PortalCard>
      </PortalPage>
    </AppShell>
  );
}
