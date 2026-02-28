import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
type BadgeSize = 'sm' | 'md';

export function Badge({
  children,
  className,
  tone = 'neutral',
  size = 'md',
}: {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
  size?: BadgeSize;
}) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, `ui-badge--${size}`, className ?? ''].join(' ').trim()}>
      {children}
    </span>
  );
}

