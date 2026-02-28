import type { ReactNode } from 'react';
import { PortalCard } from './PortalCard';

type PortalListProps = {
  children: ReactNode;
  className?: string;
};

export function PortalList({ children, className }: PortalListProps) {
  return <PortalCard className={`portal-list inbox-list-card ${className ?? ''}`.trim()}>{children}</PortalCard>;
}
