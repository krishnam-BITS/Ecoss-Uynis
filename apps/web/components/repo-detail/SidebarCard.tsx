import type { ReactNode } from 'react';
import { Card } from '../../src/components/ui';

export function SidebarCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`repo-detail-sidebar-card ${className ?? ''}`.trim()}>
      <h3>{title}</h3>
      <div className="repo-detail-sidebar-body">{children}</div>
    </Card>
  );
}
