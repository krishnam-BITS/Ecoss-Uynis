import type { ReactNode } from 'react';
import { PortalCard } from './PortalCard';

type PortalToolbarProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function PortalToolbar({
  title,
  subtitle,
  actions,
  children,
  className,
}: PortalToolbarProps) {
  return (
    <PortalCard className={`portal-toolbar inbox-toolbar-card ${className ?? ''}`.trim()}>
      <div className="portal-toolbar-head inbox-toolbar-head">
        <div>
          <h2 className="canvas-title">{title}</h2>
          {subtitle ? <p className="canvas-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="portal-toolbar-actions inbox-toolbar-actions">{actions}</div> : null}
      </div>
      {children}
    </PortalCard>
  );
}
