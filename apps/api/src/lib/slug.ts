export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ROUTE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUTE_SLUG_MIN_LENGTH = 2;
const ROUTE_SLUG_MAX_LENGTH = 63;

export function validateRouteSlug(value: string): string | null {
  if (!value) {
    return 'Slug is required.';
  }
  if (value.length < ROUTE_SLUG_MIN_LENGTH) {
    return `Slug must be at least ${ROUTE_SLUG_MIN_LENGTH} characters.`;
  }
  if (value.length > ROUTE_SLUG_MAX_LENGTH) {
    return `Slug must be ${ROUTE_SLUG_MAX_LENGTH} characters or fewer.`;
  }
  if (!ROUTE_SLUG_PATTERN.test(value)) {
    return 'Slug may contain lowercase letters, numbers, and single hyphens only.';
  }
  return null;
}
