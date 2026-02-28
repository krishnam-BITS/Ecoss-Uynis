import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export function Alert({
  title,
  description,
  tone = 'info',
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  tone?: AlertTone;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['ui-alert', `ui-alert--${tone}`, className ?? ''].join(' ').trim()} role="status">
      <div className="ui-alert__body">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  );
}

