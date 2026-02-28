'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiFetch } from '../lib/api';
import {
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
  WORKSPACE_SELECTION_EVENT,
} from '../lib/workspace';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
};

export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState<string | null>(null);
  const pathname = usePathname();

  const loadWorkspaces = useCallback(async () => {
    try {
      const workspaceData = await apiFetch<{ workspaces?: Workspace[] }>('/workspaces');
      setWorkspaces(workspaceData.workspaces ?? []);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    setSelectedWorkspaceIdState(getSelectedWorkspaceId());
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    const syncSelection = () => {
      const nextSelectedWorkspaceId = getSelectedWorkspaceId();
      setSelectedWorkspaceIdState(nextSelectedWorkspaceId);
    };

    window.addEventListener(WORKSPACE_SELECTION_EVENT, syncSelection as EventListener);
    window.addEventListener('storage', syncSelection);
    return () => {
      window.removeEventListener(WORKSPACE_SELECTION_EVENT, syncSelection as EventListener);
      window.removeEventListener('storage', syncSelection);
    };
  }, []);

  const activeWorkspacePathSegment = pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  const routeWorkspaceByIdentifier = useMemo(() => {
    if (!activeWorkspacePathSegment) {
      return null;
    }
    return (
      workspaces.find((workspace) => workspace.id === activeWorkspacePathSegment) ??
      workspaces.find((workspace) => workspace.slug === activeWorkspacePathSegment) ??
      null
    );
  }, [activeWorkspacePathSegment, workspaces]);

  const activeWorkspace = useMemo(() => {
    if (routeWorkspaceByIdentifier) {
      return routeWorkspaceByIdentifier;
    }
    if (selectedWorkspaceId) {
      const selected = workspaces.find(
        (workspace) =>
          workspace.id === selectedWorkspaceId ||
          workspace.slug === selectedWorkspaceId,
      );
      if (selected) {
        return selected;
      }
    }
    return workspaces.find((workspace) => workspace.isPersonal) ?? workspaces[0] ?? null;
  }, [routeWorkspaceByIdentifier, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!activeWorkspacePathSegment || routeWorkspaceByIdentifier) {
      return;
    }
    void loadWorkspaces();
  }, [activeWorkspacePathSegment, loadWorkspaces, routeWorkspaceByIdentifier]);

  useEffect(() => {
    if (routeWorkspaceByIdentifier?.id) {
      if (selectedWorkspaceId !== routeWorkspaceByIdentifier.id) {
        setSelectedWorkspaceId(routeWorkspaceByIdentifier.id);
        setSelectedWorkspaceIdState(routeWorkspaceByIdentifier.id);
      }
      return;
    }
    if (activeWorkspace?.id && selectedWorkspaceId !== activeWorkspace.id) {
      setSelectedWorkspaceId(activeWorkspace.id);
      setSelectedWorkspaceIdState(activeWorkspace.id);
    }
  }, [activeWorkspace, routeWorkspaceByIdentifier, selectedWorkspaceId]);

  return (
    <div className="workspace-switcher">
      <Link className="workspace-trigger workspace-trigger-link" href="/workspace" aria-label="Open workspaces">
        <span className="workspace-trigger-copy">
          <strong>{activeWorkspace?.name ?? 'Workspaces'}</strong>
        </span>
      </Link>
    </div>
  );
}
