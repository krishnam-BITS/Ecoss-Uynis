export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 64;
export const REPO_NAME_MIN = 2;
export const REPO_NAME_MAX = 96;
export const ROUTE_SLUG_MIN = 2;
export const ROUTE_SLUG_MAX = 63;

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const normalizeDisplayName = (value: string) =>
  value.trim().replace(/\s+/g, ' ');

export function validateWorkspaceName(value: string): string | null {
  if (value.length < WORKSPACE_NAME_MIN) {
    return `Workspace name must be at least ${WORKSPACE_NAME_MIN} characters.`;
  }
  if (value.length > WORKSPACE_NAME_MAX) {
    return `Workspace name must be ${WORKSPACE_NAME_MAX} characters or fewer.`;
  }
  if (!DISPLAY_NAME_PATTERN.test(value)) {
    return "Workspace name may use letters, numbers, spaces, apostrophes, periods, underscores, and hyphens.";
  }
  return null;
}

export function validateRepoName(value: string): string | null {
  if (value.length < REPO_NAME_MIN) {
    return `Repository name must be at least ${REPO_NAME_MIN} characters.`;
  }
  if (value.length > REPO_NAME_MAX) {
    return `Repository name must be ${REPO_NAME_MAX} characters or fewer.`;
  }
  if (!DISPLAY_NAME_PATTERN.test(value)) {
    return "Repository name may use letters, numbers, spaces, apostrophes, periods, underscores, and hyphens.";
  }
  return null;
}

export function normalizeSlugInput(value: string) {
  return value.trim().toLowerCase();
}

export function validateRouteSlugInput(value: string): string | null {
  if (!value.length) {
    return null;
  }
  if (value.length < ROUTE_SLUG_MIN) {
    return `Slug must be at least ${ROUTE_SLUG_MIN} characters.`;
  }
  if (value.length > ROUTE_SLUG_MAX) {
    return `Slug must be ${ROUTE_SLUG_MAX} characters or fewer.`;
  }
  if (!SLUG_PATTERN.test(value)) {
    return 'Slug may contain lowercase letters, numbers, and single hyphens only.';
  }
  return null;
}
