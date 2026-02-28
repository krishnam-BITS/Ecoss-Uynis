import type { ReactNode } from 'react';

type PortalCardProps = {
  children: ReactNode;
  className?: string;
};

export function PortalCard({ children, className }: PortalCardProps) {
  return <section className={`card canvas-card ${className ?? ''}`.trim()}>{children}</section>;
}
