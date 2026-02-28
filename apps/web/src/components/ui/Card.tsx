import type { HTMLAttributes, ReactNode } from 'react';

export function Card({
  children,
  className,
  as = 'section',
  ...props
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div';
} & HTMLAttributes<HTMLElement>) {
  const Tag = as;
  return (
    <Tag className={['ui-card', 'portal-card', className ?? ''].join(' ').trim()} {...props}>
      {children}
    </Tag>
  );
}

