'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PublicShell } from '../../components/PublicShell';
import { PortalToast } from '../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { resolveMediaUrl } from '../../lib/media';

type PublicProfile = {
  id: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  createdAt: string;
};

type PublicRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC';
  publicReadRequiresAuth: boolean;
  updatedAt: string;
  workspaceSlug?: string | null;
};

type ProfilePayload = {
  profile: PublicProfile;
  isSelf: boolean;
  workspace: {
    id: string;
    slug: string;
    name: string;
  } | null;
  stats: {
    publicRepoCount: number;
  };
  repos: PublicRepo[];
};

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const username = params.username;
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<ProfilePayload>(`/users/${encodeURIComponent(username)}/public`, {
          suppressAuthRedirect: true,
        });
        setPayload(data);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) {
          setError('Profile not found.');
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load profile.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [username]);

  const displayName = useMemo(() => {
    if (!payload) {
      return username;
    }
    return payload.profile.name || payload.profile.username;
  }, [payload, username]);
  const avatarSrc = resolveMediaUrl(payload?.profile.avatarUrl);

  return (
    <PublicShell mode="landing">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      <section className="site-canvas-section profile-public-shell">
        {isLoading ? (
          <article className="site-card profile-public-card">
            <p className="muted">Loading profile...</p>
          </article>
        ) : payload ? (
          <article className="site-card profile-public-card">
            <header className="profile-public-head">
              <div className="profile-public-avatar" aria-hidden="true">
                {avatarSrc ? (
                  <Image
                    src={avatarSrc}
                    alt={displayName}
                    width={64}
                    height={64}
                    unoptimized
                  />
                ) : (
                  <span>{displayName.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div>
                <h1>{displayName}</h1>
                <p className="muted">@{payload.profile.username}</p>
                {payload.profile.bio ? <p className="profile-public-bio">{payload.profile.bio}</p> : null}
                <div className="profile-public-meta">
                  {payload.profile.location ? <span>{payload.profile.location}</span> : null}
                  {payload.profile.website ? (
                    <a href={payload.profile.website} target="_blank" rel="noreferrer">
                      Website
                    </a>
                  ) : null}
                  <span>Joined {new Date(payload.profile.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </header>

            <section className="profile-public-repos">
              <div className="profile-public-repos-head">
                <h2>Public repositories</h2>
                <span className="muted">{payload.stats.publicRepoCount}</span>
              </div>
              {payload.repos.length ? (
                <ul className="list">
                  {payload.repos.map((repo) => {
                    const workspaceRef = repo.workspaceSlug || payload.workspace?.slug;
                    const href = workspaceRef
                      ? `/workspaces/${workspaceRef}/repos/${repo.slug}`
                      : '/';
                    return (
                      <li key={repo.id} className="queue-item profile-public-repo-row">
                        <div>
                          <Link href={href}>{repo.name}</Link>
                          <p className="muted">
                            Updated {new Date(repo.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        {repo.publicReadRequiresAuth && !hasToken ? (
                          <Link className="ghost small" href={`/login?from=${encodeURIComponent(href)}`}>
                            Login to contribute
                          </Link>
                        ) : (
                          <Link className="primary small" href={href}>
                            Open
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">No public repositories.</p>
              )}
            </section>
          </article>
        ) : (
          <article className="site-card profile-public-card">
            <p className="muted">Profile not found.</p>
            <Link className="primary small" href="/">
              Home
            </Link>
          </article>
        )}
      </section>
    </PublicShell>
  );
}

