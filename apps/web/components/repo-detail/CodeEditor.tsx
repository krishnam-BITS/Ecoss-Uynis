'use client';

import { useMemo, useRef } from 'react';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sh: 'shell',
  sql: 'sql',
  xml: 'xml',
  txt: 'plaintext',
};

function languageForPath(pathValue: string) {
  const extension = pathValue.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext';
}

export function RepoCodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  minHeight = 480,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  minHeight?: number;
}) {
  const language = useMemo(() => languageForPath(path), [path]);
  const lineNumbers = useMemo(() => {
    const lineCount = Math.max(1, value.split('\n').length);
    return Array.from({ length: lineCount }, (_, index) => `${index + 1}`).join('\n');
  }, [value]);
  const gutterRef = useRef<HTMLPreElement | null>(null);

  const syncGutterScroll = (scrollTop: number) => {
    if (!gutterRef.current) {
      return;
    }
    gutterRef.current.scrollTop = scrollTop;
  };

  return (
    <div
      className="repo-monaco-wrap repo-code-editor-fallback"
      style={{ minHeight }}
      data-language={language}
    >
      <pre ref={gutterRef} className="repo-code-editor-gutter" aria-hidden="true">
        {lineNumbers}
      </pre>
      <textarea
        className="repo-inline-editor repo-code-editor-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => syncGutterScroll(event.currentTarget.scrollTop)}
        readOnly={readOnly}
        spellCheck={language === 'markdown'}
        style={{ minHeight }}
        aria-label={`Code editor (${language})`}
      />
    </div>
  );
}
