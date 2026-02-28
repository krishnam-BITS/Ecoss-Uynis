import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card } from '../../src/components/ui';

type DetailHeaderStatus = 'open' | 'closed' | 'merged' | 'neutral';

type DetailHeaderBreadcrumb = {
  label: string;
  href?: string;
};

export function DetailHeader({
  breadcrumbs,
  title,
  subtitle,
  status,
  statusLabel,
  identifier,
  actions,
  className,
}: {
  breadcrumbs: DetailHeaderBreadcrumb[];
  title: string;
  subtitle?: string;
  status: DetailHeaderStatus;
  statusLabel: string;
  identifier: string;
  actions?: ReactNode;
  className?: string;
}) {
  const statusTone =
    status === 'open'
      ? 'warning'
      : status === 'merged'
        ? 'accent'
        : status === 'closed'
          ? 'neutral'
          : 'neutral';

  return (
    <Card className={`repo-detail-header ${className ?? ''}`.trim()}>
      <nav className="repo-detail-breadcrumbs" aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="repo-detail-breadcrumb-item">
            {crumb.href ? (
              <Link className="repo-detail-breadcrumb-link" href={crumb.href}>
                {crumb.label}
              </Link>
            ) : (
              <span className="repo-detail-breadcrumb-link current">{crumb.label}</span>
            )}
            {index < breadcrumbs.length - 1 ? (
              <span className="repo-detail-breadcrumb-separator" aria-hidden="true">
                /
              </span>
            ) : null}
          </span>
        ))}
      </nav>

      <div className="repo-detail-head">
        <div className="repo-detail-head-copy">
          <h2 className="canvas-title">{title}</h2>
          {subtitle ? <p className="canvas-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="repo-detail-head-actions">{actions}</div> : null}
      </div>

      <div className="repo-detail-meta-row">
        <Badge tone={statusTone}>{statusLabel}</Badge>
        <span className="muted">{identifier}</span>
      </div>
    </Card>
  );
}
