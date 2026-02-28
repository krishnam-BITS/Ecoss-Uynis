import type { ReactNode } from 'react';

type CardStackProps = {
  children: ReactNode;
  className?: string;
};

export function CardStack({ children, className }: CardStackProps) {
  return <div className={['repo-card-stack', className].filter(Boolean).join(' ')}>{children}</div>;
}
