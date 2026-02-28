'use client';

import { useEffect, type ReactNode } from 'react';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { apiFetch } from '../../../../../lib/api';

type RepoResponse = {
  repo?: {
    slug?: string | null;
    workspace?: {
      slug?: string | null;
    } | null;
  };
};

export default function RepoRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  useEffect(() => {
    const workspaceRef = params.workspaceId;
    const repoRef = params.repoId;
    if (!workspaceRef || !repoRef) {
      return;
    }

    const run = async () => {
      try {
        const data = await apiFetch<RepoResponse>(
          `/workspaces/${workspaceRef}/repos/${repoRef}`,
          { suppressAuthRedirect: true },
        );
        const workspaceSlug = data.repo?.workspace?.slug?.trim();
        const repoSlug = data.repo?.slug?.trim();
        if (!workspaceSlug || !repoSlug) {
          return;
        }

        if (workspaceSlug === workspaceRef && repoSlug === repoRef) {
          return;
        }

        const currentPrefix = `/workspaces/${workspaceRef}/repos/${repoRef}`;
        if (!pathname.startsWith(currentPrefix)) {
          return;
        }

        const suffix = pathname.slice(currentPrefix.length);
        const normalizedSuffix = suffix === '/share' ? '' : suffix;
        const nextPathname = `/workspaces/${workspaceSlug}/repos/${repoSlug}${normalizedSuffix}`;
        const query = searchParamsString;
        const current = query ? `${pathname}?${query}` : pathname;
        const next = query ? `${nextPathname}?${query}` : nextPathname;

        if (current !== next) {
          router.replace(next);
        }
      } catch {
        // Keep route unchanged when repository lookup fails.
      }
    };

    void run();
  }, [params.repoId, params.workspaceId, pathname, router, searchParamsString]);

  return <>{children}</>;
}
