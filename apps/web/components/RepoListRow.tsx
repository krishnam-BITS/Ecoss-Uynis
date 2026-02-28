import Link from 'next/link';
import { PortalBadge, PortalRow } from './portal';

type RepoVisibility = 'PUBLIC' | 'PRIVATE' | 'INTERNAL';

export type RepoLanguage = {
  language: string;
  bytes: number;
  percent: number;
  color?: string | null;
};

type RepoListRowProps = {
  name: string;
  defaultBranch?: string | null;
  visibility: RepoVisibility;
  href: string;
  className?: string;
  languages?: RepoLanguage[];
};

function sanitizeBranchDisplay(value: string | null | undefined): string {
  if (!value) {
    return 'main';
  }
  let next = value.trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!next.includes('%')) {
      break;
    }
    try {
      next = decodeURIComponent(next);
    } catch {
      break;
    }
  }
  return (
    next
      .replace(/^refs\/heads\//, '')
      .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}/gi, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/%+$/g, '')
      .trim() || 'main'
  );
}

export function RepoListRow({
  name,
  defaultBranch,
  visibility,
  href,
  className,
  languages = [],
}: RepoListRowProps) {
  const badgeVariant =
    visibility === 'PUBLIC' ? 'public' : visibility === 'INTERNAL' ? 'internal' : 'private';
  const languageItems = languages.filter((item) => item.percent > 0).slice(0, 4);

  return (
    <PortalRow className={`repo-list-row ${className ?? ''}`.trim()}>
      <div className="repo-list-row-main">
        <div className="repo-list-row-left">
          <strong className="repo-list-row-title" title={name}>
            {name}
          </strong>
          {languageItems.length ? (
            <div className="repo-language-summary" aria-label="Language breakdown">
              <div className="repo-language-bar" aria-hidden="true">
                {languageItems.map((item) => (
                  <span
                    key={item.language}
                    className="repo-language-segment"
                    style={{
                      width: `${item.percent}%`,
                      backgroundColor: item.color || 'var(--inbox-border-strong)',
                    }}
                  />
                ))}
              </div>
              <div className="repo-language-list">
                {languageItems.map((item) => (
                  <span key={item.language} className="repo-language-item">
                    <span
                      className="repo-language-dot"
                      aria-hidden="true"
                      style={{ backgroundColor: item.color || 'var(--inbox-border-strong)' }}
                    />
                    <span>{item.language}</span>
                    <span>{item.percent.toFixed(item.percent < 10 ? 1 : 0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="repo-list-row-right">
          <span className="repo-list-row-branch-text">
            default: {sanitizeBranchDisplay(defaultBranch)}
          </span>
          <PortalBadge className="repo-list-row-control repo-list-row-visibility" variant={badgeVariant}>
            {visibility}
          </PortalBadge>
          <Link className="primary small repo-list-row-control repo-list-row-open" href={href}>
            Open
          </Link>
        </div>
      </div>
    </PortalRow>
  );
}

