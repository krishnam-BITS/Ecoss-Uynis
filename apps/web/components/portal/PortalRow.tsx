import type { ReactNode } from 'react';

type PortalRowProps = {
  children: ReactNode;
  className?: string;
};

export function PortalRow({ children, className }: PortalRowProps) {
  return <li className={`queue-item ${className ?? ''}`.trim()}>{children}</li>;
}
