'use client';

import Link from 'next/link';
import { AppShell } from '../../components/AppShell';

export default function DocsPage() {
  return (
    <AppShell title="Docs">
      <section className="card">
        <h2>Documentation</h2>
        <p className="muted">
          Centralize product docs, onboarding guides, and API usage notes here.
        </p>
        <div className="row">
          <Link className="ghost" href="/help">
            Public help center
          </Link>
          <Link className="ghost" href="/developers">
            Developer quickstart
          </Link>
          <Link className="ghost" href="/settings/developer">
            API access
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
