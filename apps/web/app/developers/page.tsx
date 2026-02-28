'use client';

import { AppShell } from '../../components/AppShell';
import { GIT_BASE_URL } from '../../lib/config';
import { Button, Card, SectionHeader } from '../../src/components/ui';

export default function DevelopersPage() {
  const exampleWorkspace = 'acme';
  const exampleRepo = 'platform';
  const cloneUrl = `${GIT_BASE_URL}/${exampleWorkspace}/${exampleRepo}.git`;

  return (
    <AppShell title="Developers">
      <div className="portal-container portal-stack developers-hub-shell">
        <Card className="portal-card">
          <SectionHeader
            title="Developer hub"
            subtitle="Git access, PAT usage, webhooks, search, SDK and tooling guidance."
            actions={
              <Button href="/docs" variant="ghost" size="sm">
                Product docs
              </Button>
            }
          />
          <p className="muted">
            Uynis Git HTTP is served by git-storage on port 4001. API on port 4000 is metadata/API only.
          </p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="Getting started" subtitle="Clone and contribute using the canonical Git edge." />
          <pre className="developers-code">
{`# Public repository clone
git clone ${cloneUrl}

# Private repository clone (PAT required)
git clone ${cloneUrl}

# Add remote in an existing repo
git remote add uynis ${cloneUrl}`}
          </pre>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="PAT scopes" subtitle="Use the minimum scope needed for each workflow." />
          <ul className="developers-list">
            <li>
              <strong>repo:read</strong> for private clone/fetch and read-only API access.
            </li>
            <li>
              <strong>repo:write</strong> for push and write operations.
            </li>
            <li>
              <strong>repo:admin</strong> for repository admin operations (access/settings/protected repo controls).
            </li>
            <li>
              <strong>platform:admin</strong> for `/admin/*` system operations (system-admin identities only).
            </li>
          </ul>
          <pre className="developers-code">
{`# API with Bearer PAT
curl -H "Authorization: Bearer <PAT>" http://localhost:4000/me

# Git over HTTP (Basic auth)
# username: any non-empty string
# password: <PAT>`}
          </pre>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="Why Git Credential Manager prompts for localhost:4001" />
          <p className="muted">
            Git credentials are requested for HTTP remotes when read/write access is protected. In Uynis,
            private clone and push require authentication on the Git edge at port 4001, so Git Credential
            Manager prompts for credentials. Use your PAT as the password, or configure SSH if your setup
            supports it.
          </p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="Webhooks" subtitle="Repository webhooks are delivered by worker with retries." />
          <p className="muted">
            Verify signatures using your webhook secret and the signature header below.
          </p>
          <pre className="developers-code">x-uynis-signature-256: sha256=&lt;hex-hmac&gt;</pre>
          <p className="muted">Secret rotation is available from repository settings.</p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="Search used by the UI" subtitle="OpenSearch-backed routes already wired in web." />
          <pre className="developers-code">
{`GET /search?q=<query>&type=issues|pulls|discussions
GET /search/code?q=<query>&repoId=<repo>&branch=<optional>`}
          </pre>
          <p className="muted">
            Code search deep links open repository file view when path data is present.
          </p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="SDK" subtitle="@uynis/sdk client package" />
          <pre className="developers-code">
{`import { UynisClient } from '@uynis/sdk';

const client = new UynisClient({ baseUrl: 'http://localhost:4000', token: '<PAT>' });
const me = await client.getMe();`}
          </pre>
          <p className="muted">
            Current SDK exports include auth + profile helpers, workspace/repo creation, commits, and import utilities.
          </p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="CLI status" />
          <p className="muted">
            CLI is on the roadmap. Current supported workflow is Git + PAT, plus direct API usage (or SDK).
          </p>
        </Card>

        <Card className="portal-card developers-hub-card">
          <SectionHeader title="Safety reminders" />
          <ul className="developers-list">
            <li>Never commit tokens or secrets to the repository.</li>
            <li>Use `.env.example` as your local configuration template.</li>
            <li>Rotate PAT and webhook secrets if credentials are exposed.</li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
