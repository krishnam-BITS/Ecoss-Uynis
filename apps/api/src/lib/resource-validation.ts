export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 64;
export const REPO_NAME_MIN = 2;
export const REPO_NAME_MAX = 96;
export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 64;

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function validateDisplayName(
  value: string,
  label: string,
  minLength: number,
  maxLength: number,
) {
  if (value.length < minLength) {
    return `${label} name must be at least ${minLength} characters.`;
  }
  if (value.length > maxLength) {
    return `${label} name must be ${maxLength} characters or fewer.`;
  }
  if (!DISPLAY_NAME_PATTERN.test(value)) {
    return `${label} name may use letters, numbers, spaces, apostrophes, periods, underscores, and hyphens.`;
  }
  return null;
}

export function validateWorkspaceName(value: string) {
  return validateDisplayName(
    value,
    'Workspace',
    WORKSPACE_NAME_MIN,
    WORKSPACE_NAME_MAX,
  );
}

export function validateRepoName(value: string) {
  return validateDisplayName(value, 'Repository', REPO_NAME_MIN, REPO_NAME_MAX);
}

export function validateTeamName(value: string) {
  return validateDisplayName(value, 'Team', TEAM_NAME_MIN, TEAM_NAME_MAX);
}
