'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { PortalPage, PortalToolbar } from '../../components/portal';
import { apiFetch } from '../../lib/api';

type WorkspaceInvite = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
  invitedEmail?: string | null;
  invitedUsername?: string | null;
  message?: string | null;
  expiresAt: string;
  respondedAt?: string | null;
  createdAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    isPersonal?: boolean;
  };
  invitedBy: {
    id: string;
    name?: string | null;
    username?: string | null;
    email?: string | null;
  };
};

export default function WorkspaceInvitesPage() {
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ invites: WorkspaceInvite[] }>('/workspace-invites');
      setInvites(data.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invites.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const acceptInvite = async (inviteId: string, workspaceSlug: string) => {
    setBusyInviteId(inviteId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch(`/workspace-invites/${inviteId}/accept`, { method: 'POST' });
      setStatus('Invite accepted.');
      setInvites((prev) =>
        prev.map((invite) =>
          invite.id === inviteId ? { ...invite, status: 'ACCEPTED' } : invite,
        ),
      );
      window.location.href = `/workspaces/${workspaceSlug}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to accept invite.');
    } finally {
      setBusyInviteId(null);
    }
  };

  const declineInvite = async (inviteId: string) => {
    setBusyInviteId(inviteId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch(`/workspace-invites/${inviteId}/decline`, { method: 'POST' });
      setStatus('Invite declined.');
      setInvites((prev) =>
        prev.map((invite) =>
          invite.id === inviteId ? { ...invite, status: 'DECLINED' } : invite,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decline invite.');
    } finally {
      setBusyInviteId(null);
    }
  };

  const pendingInvites = invites.filter((invite) => invite.status === 'PENDING');
  const historyInvites = invites.filter((invite) => invite.status !== 'PENDING');

  return (
    <AppShell>
      <PortalPage className="inbox-shell">
        <PortalToolbar
          title="Workspace invites"
          subtitle="Accept or decline workspace invitations."
          actions={
            <button className="ghost small" type="button" onClick={() => void load()}>
              Refresh
            </button>
          }
        />
        {error ? <p className="error">{error}</p> : null}
        {status ? <p className="success">{status}</p> : null}

        <section className="card canvas-card stack">
          <h2>Pending invites</h2>
          {isLoading ? (
            <p className="muted">Loading invites...</p>
          ) : pendingInvites.length ? (
            <ul className="list">
              {pendingInvites.map((invite) => (
                <li key={invite.id}>
                  <div>
                    <strong>{invite.workspace.name}</strong>
                    <span className="muted">
                      Role: {invite.role} - invited by{' '}
                      {invite.invitedBy.name ||
                        invite.invitedBy.username ||
                        invite.invitedBy.email ||
                        'workspace admin'}
                    </span>
                    <span className="muted">
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="row">
                    <button
                      className="primary small"
                      type="button"
                      disabled={busyInviteId === invite.id}
                      onClick={() =>
                        void acceptInvite(invite.id, invite.workspace.slug)
                      }
                    >
                      {busyInviteId === invite.id ? 'Working...' : 'Accept'}
                    </button>
                    <button
                      className="ghost small"
                      type="button"
                      disabled={busyInviteId === invite.id}
                      onClick={() => void declineInvite(invite.id)}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No pending invites.</p>
          )}
        </section>

        <section className="card canvas-card stack">
          <h2>Invite history</h2>
          {historyInvites.length ? (
            <ul className="list">
              {historyInvites.map((invite) => (
                <li key={invite.id}>
                  <div>
                    <strong>{invite.workspace.name}</strong>
                    <span className="muted">
                      {invite.status} - {new Date(invite.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No invite history yet.</p>
          )}
        </section>
      </PortalPage>
    </AppShell>
  );
}
