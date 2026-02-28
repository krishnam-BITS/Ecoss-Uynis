'use client';

import { useState } from 'react';
import { PortalToast } from '../../../components/PortalToast';
import { PatManagement } from '../../../src/components/settings/PatManagement';
import { Card, SectionHeader } from '../../../src/components/ui';

type Tone = 'success' | 'error' | 'warning' | 'info';

export default function DeveloperSettingsPage() {
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);

  return (
    <div className="portal-container portal-stack settings-developer-shell">
      {toast ? (
        <PortalToast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}

      <Card className="portal-card settings-developer-intro">
        <SectionHeader
          title="Developer access"
          subtitle="Manage PATs for CLI, Git-over-HTTP, and API integrations."
        />
        <div className="settings-developer-grid">
          <article className="settings-developer-item">
            <p className="settings-developer-label">Git</p>
            <h3 className="settings-developer-title">Use PAT as password for HTTPS remotes</h3>
            <p className="settings-developer-description">Clone, fetch, and push with HTTPS + PAT.</p>
            <pre className="settings-developer-code">
              <code>http://localhost:4001/&lt;workspace&gt;/&lt;repo&gt;.git</code>
            </pre>
          </article>
          <article className="settings-developer-item">
            <p className="settings-developer-label">API</p>
            <h3 className="settings-developer-title">Use PAT in Bearer token</h3>
            <p className="settings-developer-description">Send PAT in Authorization header for API calls.</p>
            <pre className="settings-developer-code">
              <code>Authorization: Bearer uynis_pat_...</code>
            </pre>
          </article>
          <article className="settings-developer-item">
            <p className="settings-developer-label">Security</p>
            <h3 className="settings-developer-title">Platform admin scope is restricted</h3>
            <p className="settings-developer-description">
              Use `repo:read`, `repo:write`, or `repo:admin` for repository workflows. `platform:admin` is
              available only to configured system-admin identities.
            </p>
          </article>
        </div>
      </Card>

      <Card className="portal-card">
        <PatManagement onNotify={(message, tone = 'info') => setToast({ message, tone })} />
      </Card>
    </div>
  );
}
