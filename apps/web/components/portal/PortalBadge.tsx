import type { ReactNode } from 'react';

type PortalBadgeProps = {
  children: ReactNode;
  variant?: 'default' | 'public' | 'private' | 'internal';
  className?: string;
};

export function PortalBadge({ children, variant = 'default', className }: PortalBadgeProps) {
  return <span className={`portal-badge ${variant} ${className ?? ''}`.trim()}>{children}</span>;
}
