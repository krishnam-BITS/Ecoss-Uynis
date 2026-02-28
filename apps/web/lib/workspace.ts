const WORKSPACE_KEY = 'uynis_workspace';
export const WORKSPACE_SELECTION_EVENT = 'uynis:workspace-selection-change';

function emitWorkspaceSelection(id: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_SELECTION_EVENT, {
      detail: { id },
    }),
  );
}

export function getSelectedWorkspaceId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(WORKSPACE_KEY);
}

export function setSelectedWorkspaceId(id: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const current = window.localStorage.getItem(WORKSPACE_KEY);
  if (current === id) {
    return;
  }
  window.localStorage.setItem(WORKSPACE_KEY, id);
  emitWorkspaceSelection(id);
}

export function clearSelectedWorkspaceId(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (!window.localStorage.getItem(WORKSPACE_KEY)) {
    return;
  }
  window.localStorage.removeItem(WORKSPACE_KEY);
  emitWorkspaceSelection(null);
}
