import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['ui-empty-state', className ?? ''].join(' ').trim()} role="status">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ui-empty-state__actions">{action}</div> : null}
    </div>
  );
}

