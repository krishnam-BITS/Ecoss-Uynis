import { useId } from 'react';
import type { ReactNode } from 'react';

export function Dropdown({
  label,
  children,
  className,
  align = 'left',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const contentId = useId();

  return (
    <details className={['ui-dropdown', className ?? ''].join(' ').trim()}>
      <summary className="ui-dropdown__trigger" aria-controls={contentId}>
        {label}
      </summary>
      <div id={contentId} className={['ui-dropdown__content', `ui-dropdown__content--${align}`].join(' ')}>
        {children}
      </div>
    </details>
  );
}
