import type { ReactNode } from 'react';

type PortalPageProps = {
  children: ReactNode;
  className?: string;
};

export function PortalPage({ children, className }: PortalPageProps) {
  return <div className={`canvas-shell inbox-shell portal-page ${className ?? ''}`.trim()}>{children}</div>;
}
