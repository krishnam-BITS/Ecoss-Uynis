export type MentionOption = {
  label: string;
  handle: string;
};

const handleSanitize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 24);

export function buildMentionOptions(
  labels: Array<string | null | undefined>,
  options?: { includeAll?: boolean },
): MentionOption[] {
  const map = new Map<string, MentionOption>();
  if (options?.includeAll) {
    map.set('all', { label: 'All', handle: 'all' });
  }
  for (const label of labels) {
    if (!label) {
      continue;
    }
    const handle = handleSanitize(label);
    if (!handle || map.has(handle)) {
      continue;
    }
    map.set(handle, { label, handle });
  }
  return Array.from(map.values());
}

export function getMentionQuery(text: string): string | null {
  const match = text.match(/@([a-zA-Z0-9._-]{0,32})$/);
  if (!match) {
    return null;
  }
  return match[1].toLowerCase();
}

export function applyMention(text: string, handle: string): string {
  const next = text.replace(/@([a-zA-Z0-9._-]{0,32})$/, `@${handle} `);
  return next;
}