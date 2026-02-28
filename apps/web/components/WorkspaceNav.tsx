type WorkspaceNavProps = {
  workspaceId: string;
  active: 'overview' | 'people' | 'teams' | 'access' | 'settings';
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  isPersonal?: boolean;
};

// Workspace navigation is now handled by the shell sidebar.
// Keep this component as a no-op to avoid duplicate in-canvas nav strips.
export function WorkspaceNav(_props: WorkspaceNavProps) {
  return null;
}
