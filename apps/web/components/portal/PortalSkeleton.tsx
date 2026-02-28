import type { ReactNode } from 'react';

export function PortalSkeletonRows({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`portal-skeleton-block ${className ?? ''}`.trim()} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <span
          key={`portal-skeleton-row-${index}`}
          className={`portal-skeleton-row ${index === 0 ? 'is-wide' : index === rows - 1 ? 'is-mid' : ''}`}
        />
      ))}
    </div>
  );
}

export function PortalCardSkeleton({
  lines = 3,
  className,
  footer,
}: {
  lines?: number;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <article className={`card canvas-card portal-skeleton-card ${className ?? ''}`.trim()}>
      <PortalSkeletonRows rows={lines} />
      {footer ? <div className="portal-skeleton-footer">{footer}</div> : null}
    </article>
  );
}

