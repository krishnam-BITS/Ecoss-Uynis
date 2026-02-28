import type { ReactNode } from 'react';

export function InlineFormRow({
  children,
  className,
  align = 'end',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <div className={['ui-inline-form-row', `ui-inline-form-row--${align}`, className ?? ''].join(' ').trim()}>
      {children}
    </div>
  );
}

