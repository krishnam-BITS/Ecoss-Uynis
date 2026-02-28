'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getToken } from '../lib/auth';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  return (
    <section className="status-shell">
      <div className="status-card">
        <p className="status-code">Error</p>
        <h1 className="status-title">Something went wrong.</h1>
        <p className="status-copy">
          Try again once. If the problem continues, return to your main entry page.
        </p>
        <div className="status-actions">
          <button className="status-btn status-btn-primary" type="button" onClick={() => reset()}>
            Retry
          </button>
          <Link className="status-btn status-btn-secondary" href="/">
            Home
          </Link>
          <Link className="status-btn status-btn-secondary" href={hasToken ? '/dashboard' : '/login'}>
            {hasToken ? 'Dashboard' : 'Login'}
          </Link>
        </div>
      </div>
    </section>
  );
}

