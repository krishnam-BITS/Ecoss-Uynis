import type { CSSProperties } from 'react';

export function Skeleton({
  className,
  width,
  height,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  const style: CSSProperties = {};
  if (typeof width !== 'undefined') {
    style.width = width;
  }
  if (typeof height !== 'undefined') {
    style.height = height;
  }
  return <span className={['ui-skeleton', className ?? ''].join(' ').trim()} style={style} />;
}

export function SkeletonLines({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={['ui-skeleton-lines', className ?? ''].join(' ').trim()} aria-hidden="true">
      {Array.from({ length: Math.max(1, count) }).map((_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

