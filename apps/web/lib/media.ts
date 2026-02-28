const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export function resolveMediaUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('data:') ||
    raw.startsWith('blob:')
  ) {
    return raw;
  }
  if (raw.startsWith('/uploads/')) {
    return `${API_ORIGIN}${raw}`;
  }
  return raw;
}
