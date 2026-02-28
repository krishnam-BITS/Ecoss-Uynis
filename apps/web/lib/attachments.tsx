import Image from 'next/image';
import type { ReactNode } from 'react';

const urlRegex = /(https?:\/\/[^\s]+)/g;
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function appendSizeParam(url: string, size?: number | null) {
  if (!size || size <= 0) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}size=${encodeURIComponent(String(size))}`;
}

function isAttachmentUrl(url: string) {
  return url.includes('/uploads/attachments/');
}

function getFileName(url: string) {
  const clean = url.split('?')[0];
  const parts = clean.split('/');
  const name = parts[parts.length - 1] || 'attachment';
  return decodeURIComponent(name);
}

function getExtension(name: string) {
  const segments = name.split('.');
  return segments.length > 1 ? segments[segments.length - 1].toLowerCase() : '';
}

function renderUrl(url: string, index: number): ReactNode {
  if (!isAttachmentUrl(url)) {
    return (
      <a key={`link-${index}`} className="message-link" href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
    );
  }

  const fileName = getFileName(url);
  const extension = getExtension(fileName);
  const isImage = imageExtensions.has(extension);

  return (
    <a
      key={`attachment-${index}`}
      className={`attachment-card ${isImage ? 'is-image' : 'is-file'}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <span className="attachment-meta">
        <span className="attachment-name">{fileName}</span>
        <span className="attachment-action">Open</span>
      </span>
      {isImage ? (
        <Image
          className="attachment-preview"
          src={url}
          alt={fileName}
          width={640}
          height={360}
          loading="lazy"
          unoptimized
        />
      ) : null}
    </a>
  );
}

export function renderRichText(text: string): ReactNode[] {
  if (!text) {
    return [];
  }
  return text.split(urlRegex).map((part, index) => {
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return renderUrl(part, index);
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
}
