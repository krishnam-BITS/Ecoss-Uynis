type TimelineTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

function formatTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString();
}

export function TimelineItem({
  title,
  body,
  actor,
  createdAt,
  tone = 'default',
}: {
  title: string;
  body?: string | null;
  actor?: string | null;
  createdAt: string | Date;
  tone?: TimelineTone;
}) {
  return (
    <article className={`repo-detail-timeline-item tone-${tone}`}>
      <header className="repo-detail-timeline-head">
        <strong>{title}</strong>
        <span className="muted">{formatTimestamp(createdAt)}</span>
      </header>
      {actor ? <p className="repo-detail-timeline-actor muted">By {actor}</p> : null}
      {body ? <div className="repo-detail-timeline-body">{body}</div> : null}
    </article>
  );
}

