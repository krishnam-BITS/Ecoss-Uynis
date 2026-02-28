type RepoNavProps = {
  workspaceId: string;
  repoId: string;
  active:
    | 'code'
    | 'issues'
    | 'pulls'
    | 'insights'
    | 'share'
    | 'access'
    | 'settings';
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | 'OWNER' | null;
};

// Repository navigation is now provided by the sidebar + top shell navigation.
// Keep this component as a no-op to preserve page-level imports without duplicate nav rails.
export function RepoNav(_props: RepoNavProps) {
  return null;
}
