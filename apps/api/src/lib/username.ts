export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 39;
export const USERNAME_CHANGE_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
export const USERNAME_REVERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const USERNAME_LETTER_PATTERN = /[A-Za-z]/;

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) {
    return 'Username is required.';
  }
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username may only include letters, numbers, ".", "_" and "-".';
  }
  if (!USERNAME_LETTER_PATTERN.test(username)) {
    return 'Username must include at least one letter.';
  }
  return null;
}
