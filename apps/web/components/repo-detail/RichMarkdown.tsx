'use client';

import { MarkdownViewer } from './MarkdownViewer';

export function RepoRichMarkdown({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return <MarkdownViewer content={markdown} className={className} emptyMessage="No content." />;
}
