'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicShell } from './PublicShell';
import { PortalHome } from './PortalHome';
import { LANDING_SEARCH_ITEMS } from '../lib/public-navigation';
import { getToken } from '../lib/auth';

export function LandingPage({ forcePublic = false }: { forcePublic?: boolean } = {}) {
  const [hasToken, setHasToken] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const syncToken = () => setHasToken(Boolean(getToken()));
    syncToken();
    setIsReady(true);
    window.addEventListener('storage', syncToken);
    window.addEventListener('focus', syncToken);
    return () => {
      window.removeEventListener('storage', syncToken);
      window.removeEventListener('focus', syncToken);
    };
  }, []);

  if (!isReady) {
    return <div className="app-boot-screen" aria-hidden="true" />;
  }

  if (hasToken && !forcePublic) {
    return <PortalHome />;
  }

  return (
    <PublicShell
      activeTopNav="product"
      searchModel={{
        items: LANDING_SEARCH_ITEMS,
        placeholder: 'Search product, repositories, reviews, and policies',
      }}
    >
      <div className="landing-root">
        <section id="product" className="landing-hero landing-anchor-target">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Modern code collaboration platform</p>
            <h1>Build, review, and ship with one workspace system.</h1>
            <p className="landing-lede">
              Uynis combines repositories, pull requests, issues, notifications, and
              discussions into one operational flow for personal and team workspaces.
            </p>
            <div className="landing-hero-actions">
              {hasToken ? (
                <Link className="primary" href="/dashboard">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link className="primary" href="/signup">
                    Start with a workspace
                  </Link>
                  <Link className="ghost" href="/login">
                    Log in
                  </Link>
                </>
              )}
            </div>
          </div>
          <aside className="landing-stage-card">
            <header className="landing-stage-head">
              <p>Unified flow</p>
              <strong>From code to review to release</strong>
            </header>
            <div className="landing-stage-grid">
              <article className="landing-stage-item">
                <span>Workspace model</span>
                <strong>Personal + Team</strong>
                <p>Context-aware access and collaboration controls.</p>
              </article>
              <article className="landing-stage-item">
                <span>Repository lifecycle</span>
                <strong>Create or Import</strong>
                <p>Start from blank, zip upload, or remote import.</p>
              </article>
              <article className="landing-stage-item">
                <span>Review operations</span>
                <strong>Issues + Pulls</strong>
                <p>Filter by status, labels, assignee, and review state.</p>
              </article>
              <article className="landing-stage-item">
                <span>Communication</span>
                <strong>Discussions + Notifications</strong>
                <p>Decisions stay linked to workspace and repository context.</p>
              </article>
            </div>
          </aside>
        </section>

        <section className="landing-section landing-anchor-target" id="product-repositories">
          <header className="landing-section-head">
            <h2>Repository management that scales with your workspace</h2>
            <p>
              Keep public, private, and internal repositories organized with clear
              ownership and visibility controls.
            </p>
          </header>
          <div className="landing-value-grid">
            <article className="landing-value-card">
              <h3>Create or import quickly</h3>
              <p>
                Use guided create/import dialogs with branch defaults and safe validation.
              </p>
            </article>
            <article className="landing-value-card">
              <h3>Visibility policies</h3>
              <p>
                Configure repository visibility and viewer access with explicit controls.
              </p>
            </article>
            <article className="landing-value-card">
              <h3>Workspace-linked governance</h3>
              <p>
                Align repository ownership with workspace members, teams, and roles.
              </p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-anchor-target" id="product-collaboration">
          <header className="landing-section-head">
            <h2>Review and collaboration without context switching</h2>
            <p>
              Keep planning and code-review loops in one place using inbox-style views.
            </p>
          </header>
          <div className="landing-flow">
            <article className="landing-flow-step">
              <span>1</span>
              <h4>Track work</h4>
              <p>Open issues with clear metadata and assignee ownership.</p>
            </article>
            <article className="landing-flow-step">
              <span>2</span>
              <h4>Run pull reviews</h4>
              <p>Prioritize review-ready pull requests and unresolved checks.</p>
            </article>
            <article className="landing-flow-step">
              <span>3</span>
              <h4>Coordinate decisions</h4>
              <p>Use discussions and notifications scoped to repositories and teams.</p>
            </article>
            <article className="landing-flow-step">
              <span>4</span>
              <h4>Ship continuously</h4>
              <p>Move from activity signals to action with a consistent shell.</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-anchor-target" id="product-workspaces">
          <header className="landing-section-head">
            <h2>Workspace controls that stay explicit</h2>
            <p>
              Personal workspaces focus on owner productivity; team workspaces support
              member roles and shared governance.
            </p>
          </header>
          <div className="landing-ownership-metrics">
            <div>
              <strong>Role-based</strong>
              <span>Owner, admin, and member permissions.</span>
            </div>
            <div>
              <strong>Shareable routes</strong>
              <span>Readable workspace/repository links for collaboration.</span>
            </div>
            <div>
              <strong>Policy aware</strong>
              <span>Workspace and repository access are aligned by design.</span>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
