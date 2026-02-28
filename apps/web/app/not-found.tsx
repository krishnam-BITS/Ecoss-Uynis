import Link from 'next/link';
import { cookies } from 'next/headers';

export default function NotFound() {
  const hasToken = Boolean(cookies().get('uynis_token')?.value);
  const secondaryHref = hasToken ? '/dashboard' : '/login';
  const secondaryLabel = hasToken ? 'Dashboard' : 'Login';

  return (
    <section className="status-shell">
      <div className="status-card">
        <p className="status-code">404</p>
        <h1 className="status-title">This page does not exist.</h1>
        <p className="status-copy">
          The link may be broken, moved, or restricted for your account context.
        </p>
        <div className="status-actions">
          <Link className="status-btn status-btn-primary" href="/">
            Home
          </Link>
          <Link className="status-btn status-btn-secondary" href={secondaryHref}>
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

