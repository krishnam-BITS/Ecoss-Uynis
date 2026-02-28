import type { Prisma } from '@uynis/db';

const LABEL_COLOR_PALETTE = [
  '#5B8CFF',
  '#2EC4B6',
  '#FF7A59',
  '#FFB703',
  '#8F7AEA',
  '#F15BB5',
  '#2A9D8F',
  '#457B9D',
] as const;

export function normalizeLabelName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

export function toLabelKey(value: string): string {
  return normalizeLabelName(value).toLowerCase();
}

export function normalizeLabelNames(values?: string[] | null): string[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const normalized = normalizeLabelName(raw);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function colorForLabel(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLOR_PALETTE[hash % LABEL_COLOR_PALETTE.length];
}

export function pickLabelColor(name: string): string {
  return colorForLabel(normalizeLabelName(name));
}

export async function ensureRepoLabels(
  tx: Prisma.TransactionClient,
  repoId: string,
  labelNames: string[],
) {
  const normalized = normalizeLabelNames(labelNames);
  if (!normalized.length) {
    return [];
  }

  const labels = await Promise.all(
    normalized.map((name) =>
      tx.repoLabel.upsert({
        where: {
          repoId_nameKey: {
            repoId,
            nameKey: toLabelKey(name),
          },
        },
        create: {
          repoId,
          name,
          nameKey: toLabelKey(name),
          color: colorForLabel(name),
        },
        update: {
          name,
        },
      }),
    ),
  );

  return labels;
}
