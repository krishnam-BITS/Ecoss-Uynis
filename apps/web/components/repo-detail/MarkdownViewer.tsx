'use client';

import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const DEFAULT_TAGS = (defaultSchema.tagNames ?? []).filter(Boolean) as string[];
const DEFAULT_ATTRS = defaultSchema.attributes ?? {};

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([
      ...DEFAULT_TAGS,
      'center',
      'div',
      'span',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'kbd',
    ]),
  ),
  attributes: {
    ...DEFAULT_ATTRS,
    '*': [
      ...((DEFAULT_ATTRS['*'] as string[] | undefined) ?? []),
      'className',
      'align',
    ],
    a: [
      ...((DEFAULT_ATTRS.a as string[] | undefined) ?? []),
      'href',
      'target',
      'rel',
      'title',
    ],
    img: [
      ...((DEFAULT_ATTRS.img as string[] | undefined) ?? []),
      'src',
      'alt',
      'title',
      'width',
      'height',
      'loading',
      'decoding',
      'referrerPolicy',
    ],
    table: [
      ...((DEFAULT_ATTRS.table as string[] | undefined) ?? []),
      'className',
    ],
    td: [
      ...((DEFAULT_ATTRS.td as string[] | undefined) ?? []),
      'align',
    ],
    th: [
      ...((DEFAULT_ATTRS.th as string[] | undefined) ?? []),
      'align',
    ],
    div: [
      ...((DEFAULT_ATTRS.div as string[] | undefined) ?? []),
      'className',
      'align',
    ],
    p: [
      ...((DEFAULT_ATTRS.p as string[] | undefined) ?? []),
      'className',
      'align',
    ],
  },
};

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (!node) {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (isValidElement(node)) {
    const nextProps = (node as ReactElement<{ children?: ReactNode }>).props;
    return extractText(nextProps.children);
  }
  return '';
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const rawCode = useMemo(() => extractText(children), [children]);

  return (
    <div className="repo-readme-code-wrap">
      <button
        type="button"
        className="repo-readme-code-copy"
        data-copy-state={copyState}
        aria-label="Copy code block"
        onClick={async () => {
          if (!rawCode) {
            return;
          }
          try {
            await navigator.clipboard.writeText(rawCode);
            setCopyState('copied');
          } catch {
            setCopyState('error');
          } finally {
            window.setTimeout(() => setCopyState('idle'), 1400);
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M5 15V7a2 2 0 0 1 2-2h8" />
        </svg>
        <span className="repo-sr-only">Copy code</span>
      </button>
      <pre className="repo-readme-code">{children}</pre>
    </div>
  );
}

function isImageNode(node: ReactNode): boolean {
  if (!isValidElement(node)) {
    return false;
  }
  if (node.type === 'img') {
    return true;
  }
  if (node.type === 'a') {
    const anchorChildren = Children.toArray(
      (node as ReactElement<{ children?: ReactNode }>).props.children,
    );
    return anchorChildren.some((child) => isImageNode(child));
  }
  return false;
}

function containsImageNode(nodes: ReactNode): boolean {
  const normalized = Children.toArray(nodes);
  return normalized.some((node) => isImageNode(node));
}

const markdownComponents: Components = {
  pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
  center: ({ children }) => <div className="repo-readme-center">{children}</div>,
  table: ({ children }) => (
    <div className="repo-readme-table-wrap">
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt, title, ...props }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      decoding="async"
      {...props}
    />
  ),
  a: ({ href, children, ...props }) => {
    const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);
    return (
      <a
        href={typeof href === 'string' ? href : undefined}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noreferrer noopener' : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
  code: ({ children, className, ...props }) => {
    const isInline = !(className?.includes('language-'));
    return (
      <code className={isInline ? 'repo-readme-inline-code' : className} {...props}>
        {children}
      </code>
    );
  },
  p: ({ children }) => {
    const compactChildren = Children.toArray(children).filter((child) => {
      if (typeof child === 'string') {
        return child.trim().length > 0;
      }
      return true;
    });
    const isImageRow =
      compactChildren.length > 1 &&
      compactChildren.every((child) => isImageNode(child));
    if (isImageRow) {
      return <p className="repo-readme-image-row">{children}</p>;
    }
    return <p>{children}</p>;
  },
  h1: ({ children }) => (
    <h1 className={containsImageNode(children) ? 'repo-readme-heading-row' : undefined}>
      {children}
    </h1>
  ),
};

export function MarkdownViewer({
  content,
  emptyMessage = 'No content provided.',
  className,
}: {
  content?: string | null;
  emptyMessage?: string;
  className?: string;
}) {
  if (!content?.trim()) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <div className={`repo-detail-markdown ${className ?? ''}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
