'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import { PortalCardSkeleton } from '../../../components/portal';
import {
  Badge,
  Button,
  EmptyState,
  InlineFormRow,
  Modal,
  SectionHeader,
} from '../ui';

type PatScope = 'repo:read' | 'repo:write' | 'repo:admin' | 'platform:admin';

type PatToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
};

type PatCreateResponse = {
  token: string;
  tokenInfo: PatToken;
};

type PatCapabilities = {
  canMintPlatformAdmin: boolean;
  availableScopes: string[];
};

type Tone = 'success' | 'error' | 'warning' | 'info';

type ExpiryPreset = '7' | '30' | '90' | 'none';

type TokenStatus = 'Active' | 'Revoked' | 'Expired';

const baseScopeOptions: Array<{ value: PatScope; label: string; hint: string }> = [
  {
    value: 'repo:read',
    label: 'repo:read',
    hint: 'Clone, fetch, and use read-only repository APIs.',
  },
  {
    value: 'repo:write',
    label: 'repo:write',
    hint: 'Push and write changes. This also covers read access, but not admin settings.',
  },
  {
    value: 'repo:admin',
    label: 'repo:admin',
    hint: 'Repository settings, access control, and protected operations. This does not include push unless repo:write is also selected.',
  },
  {
    value: 'platform:admin',
    label: 'platform:admin',
    hint: 'System-level administrative controls for platform operations.',
  },
];

const formatDate = (value?: string | null) => {
  if (!value) {
    return '--';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '--';
  }
  return parsed.toLocaleString();
};

const getStatus = (token: PatToken): TokenStatus => {
  if (token.revokedAt) {
    return 'Revoked';
  }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return 'Expired';
  }
  return 'Active';
};

const getExpiresInDays = (preset: ExpiryPreset) => {
  if (preset === 'none') {
    return undefined;
  }
  return Number.parseInt(preset, 10);
};

const describeScopeSelection = (selectedScopes: PatScope[]) => {
  if (selectedScopes.includes('platform:admin')) {
    return 'Platform admin is selected. This token can perform system-level administration.';
  }
  const hasRead = selectedScopes.includes('repo:read');
  const hasWrite = selectedScopes.includes('repo:write');
  const hasAdmin = selectedScopes.includes('repo:admin');
  if (hasWrite && hasAdmin) {
    return 'Full repository control: push/write plus repository admin settings.';
  }
  if (hasWrite) {
    return 'Read and write repository access. Good for CI or automation that pushes.';
  }
  if (hasAdmin) {
    return 'Repository admin settings only. Add repo:write too if this token also needs push access.';
  }
  if (hasRead) {
    return 'Read-only repository access.';
  }
  return 'Select at least one scope.';
};

const badgeToneForStatus = (status: TokenStatus) => {
  if (status === 'Revoked') {
    return 'warning' as const;
  }
  if (status === 'Expired') {
    return 'danger' as const;
  }
  return 'success' as const;
};

function prettyApiError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function PatManagement({
  onNotify,
}: {
  onNotify?: (message: string, tone?: Tone) => void;
}) {
  const [tokens, setTokens] = useState<PatToken[]>([]);
  const [capabilities, setCapabilities] = useState<PatCapabilities>({
    canMintPlatformAdmin: false,
    availableScopes: ['repo:read', 'repo:write', 'repo:admin'],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showTokenHistory, setShowTokenHistory] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<PatToken | null>(null);

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<PatScope[]>(['repo:read']);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('30');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedTokenMeta, setIssuedTokenMeta] = useState<PatToken | null>(null);
  const [issuedTokenById, setIssuedTokenById] = useState<Record<string, string>>({});
  const [isRevoking, setIsRevoking] = useState(false);

  const scopeOptions = useMemo(
    () =>
      baseScopeOptions.filter((scope) => {
        if (scope.value !== 'platform:admin') {
          return true;
        }
        return capabilities.canMintPlatformAdmin;
      }),
    [capabilities.canMintPlatformAdmin],
  );

  const notify = useCallback(
    (message: string, tone: Tone = 'info') => {
      onNotify?.(message, tone);
    },
    [onNotify],
  );

  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{
        tokens: PatToken[];
        capabilities?: PatCapabilities;
      }>('/me/pats');
      setTokens(data.tokens);
      if (data.capabilities) {
        setCapabilities(data.capabilities);
      }
    } catch (error) {
      notify(prettyApiError(error, 'Unable to load personal access tokens.'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  useEffect(() => {
    if (capabilities.canMintPlatformAdmin) {
      return;
    }
    setScopes((prev) => {
      const next = prev.filter((scope) => scope !== 'platform:admin');
      return next.length ? next : ['repo:read'];
    });
  }, [capabilities.canMintPlatformAdmin]);

  const sortedTokens = useMemo(() => {
    const statusPriority = (token: PatToken) => {
      const status = getStatus(token);
      if (status === 'Active') {
        return 0;
      }
      if (status === 'Revoked') {
        return 1;
      }
      return 2;
    };

    const activityTime = (token: PatToken) => {
      const updated = new Date(token.updatedAt).getTime();
      const created = new Date(token.createdAt).getTime();
      return Math.max(updated || 0, created || 0);
    };

    return [...tokens].sort((left, right) => {
      const leftPriority = statusPriority(left);
      const rightPriority = statusPriority(right);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return activityTime(right) - activityTime(left);
    });
  }, [tokens]);

  const activeTokens = useMemo(
    () => sortedTokens.filter((token) => getStatus(token) === 'Active'),
    [sortedTokens],
  );
  const archivedTokens = useMemo(
    () => sortedTokens.filter((token) => getStatus(token) !== 'Active'),
    [sortedTokens],
  );

  const resetCreateState = () => {
    setName('');
    setScopes(['repo:read']);
    setExpiryPreset('30');
    setFormError(null);
    setIssuedToken(null);
    setIssuedTokenMeta(null);
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    resetCreateState();
  };

  const toggleScope = (value: PatScope) => {
    setScopes((prev) => {
      if (prev.includes(value)) {
        if (value === 'repo:read' && prev.includes('repo:write')) {
          return prev;
        }
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter((entry) => entry !== value);
      }
      if (value === 'repo:write') {
        return prev.includes('repo:read') ? [...prev, value] : [...prev, 'repo:read', value];
      }
      return [...prev, value];
    });
  };

  const handleCreateToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Token name is required.');
      return;
    }
    if (!scopes.length) {
      setFormError('Select at least one scope.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      const expiresInDays = getExpiresInDays(expiryPreset);
      const payload: {
        name: string;
        scopes: PatScope[];
        expiresInDays?: number;
      } = {
        name: trimmedName,
        scopes,
      };

      if (typeof expiresInDays === 'number') {
        payload.expiresInDays = expiresInDays;
      }

      const data = await apiFetch<PatCreateResponse>('/me/pats', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setIssuedToken(data.token);
      setIssuedTokenMeta(data.tokenInfo);
      setIssuedTokenById((prev) => ({ ...prev, [data.tokenInfo.id]: data.token }));
      setTokens((prev) => [data.tokenInfo, ...prev]);
      notify('Personal access token created. Copy it now.', 'success');
    } catch (error) {
      setFormError(prettyApiError(error, 'Unable to create token.'));
      notify(prettyApiError(error, 'Unable to create token.'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(successMessage, 'success');
    } catch {
      notify('Unable to copy to clipboard.', 'error');
    }
  };

  const openDetails = (token: PatToken) => {
    setSelectedToken(token);
    setIsDetailsOpen(true);
  };

  const openRevoke = (token: PatToken) => {
    setSelectedToken(token);
    setIsRevokeOpen(true);
  };

  const handleRevoke = async () => {
    if (!selectedToken) {
      return;
    }

    setIsRevoking(true);
    try {
      await apiFetch<{ revoked: boolean }>(`/me/pats/${selectedToken.id}`, {
        method: 'DELETE',
      });
      setTokens((prev) =>
        prev.map((token) =>
          token.id === selectedToken.id ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
      setIsRevokeOpen(false);
      notify('Token revoked successfully.', 'success');
    } catch (error) {
      notify(prettyApiError(error, 'Unable to revoke token.'), 'error');
    } finally {
      setIsRevoking(false);
    }
  };

  const detailsTokenValue = useMemo(() => {
    if (!selectedToken) {
      return null;
    }
    return issuedTokenById[selectedToken.id] ?? null;
  }, [issuedTokenById, selectedToken]);

  const renderTokenList = (items: PatToken[], kind: 'active' | 'archived') => (
    <ul className="pat-list" aria-live="polite">
      {items.map((token) => {
        const status = getStatus(token);
        const canRevoke = status === 'Active';

        return (
          <li key={token.id} className={`pat-list-row ${kind === 'archived' ? 'is-history' : ''}`}>
            <div className="pat-list-main">
              <div className="pat-list-heading">
                <strong>{token.name}</strong>
                <Badge
                  className={`pat-status-badge is-${status.toLowerCase()}`}
                  tone={badgeToneForStatus(status)}
                  size="sm"
                >
                  {status}
                </Badge>
              </div>
              <p className="muted pat-list-meta">
                Prefix: {token.tokenPrefix}
              </p>
          <p className="muted pat-list-meta">
                Scopes: {token.scopes.join(', ') || '--'}
              </p>
              <p className="muted pat-list-meta">
                Created {formatDate(token.createdAt)} | Expires {formatDate(token.expiresAt)} | Last used{' '}
                {formatDate(token.lastUsedAt)}
              </p>
            </div>
            <div className="pat-list-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopyText(token.scopes.join(', '), 'Scopes copied.')}
              >
                Copy scopes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openDetails(token)}>
                Details
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => openRevoke(token)}
                disabled={!canRevoke}
              >
                {canRevoke ? 'Revoke' : 'Revoked'}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="repo-settings-panel pat-management-section" aria-labelledby="pat-management-heading">
      <SectionHeader
        title={<span id="pat-management-heading">Personal Access Tokens</span>}
        subtitle="Create scoped tokens for Git and API access. Active tokens are shown first; old token history is collapsed."
        actions={
          <InlineFormRow className="pat-header-actions">
            {archivedTokens.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTokenHistory((value) => !value)}
                className="pat-header-btn"
              >
                {showTokenHistory
                  ? 'Hide history'
                  : `Show history (${archivedTokens.length})`}
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="pat-header-btn"
              onClick={() => {
                resetCreateState();
                setIsCreateOpen(true);
              }}
              aria-label="Create personal access token"
            >
              Create token
            </Button>
          </InlineFormRow>
        }
      />

      <div className="pat-summary-grid pat-summary-grid--spaced" role="status" aria-live="polite">
        <article className="pat-summary-item">
          <span>Active</span>
          <strong>{activeTokens.length}</strong>
        </article>
        <article className="pat-summary-item">
          <span>Archived</span>
          <strong>{archivedTokens.length}</strong>
        </article>
        <article className="pat-summary-item">
          <span>Total</span>
          <strong>{tokens.length}</strong>
        </article>
      </div>

      {isLoading ? (
        <PortalCardSkeleton lines={4} />
      ) : activeTokens.length ? (
        renderTokenList(activeTokens, 'active')
      ) : (
        <EmptyState
          title="No active personal access tokens."
          description="Create a token to use Git over HTTPS or call APIs."
        />
      )}

      {showTokenHistory && archivedTokens.length ? (
        <div className="pat-history-shell">
          <p className="muted pat-history-note">Token history is retained for security auditing.</p>
          {renderTokenList(archivedTokens, 'archived')}
        </div>
      ) : null}

      <Modal
        open={isCreateOpen}
        onClose={closeCreateModal}
        title="Create personal access token"
        subtitle="The token value is shown only once. Save it before closing this dialog."
        closeLabel="Close create token dialog"
      >
        {issuedToken ? (
          <div className="stack">
            <p className="repo-danger-note">
              Save this token now. For security, it cannot be retrieved again from the API after this dialog closes.
            </p>
            <label className="field">
              <span>Token</span>
              <input type="text" readOnly value={issuedToken} className="repo-settings-token-preview" />
            </label>
            {issuedTokenMeta ? (
              <p className="muted">
                {issuedTokenMeta.name} | scopes: {issuedTokenMeta.scopes.join(', ')}
              </p>
            ) : null}
            <InlineFormRow className="pat-create-actions">
              <Button type="button" variant="primary" onClick={() => handleCopyText(issuedToken, 'Token copied to clipboard.')}>
                Copy token
              </Button>
              <Button type="button" variant="ghost" onClick={closeCreateModal}>
                Done
              </Button>
            </InlineFormRow>
          </div>
        ) : (
          <form className="stack pat-create-form" onSubmit={handleCreateToken}>
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="ci-bot"
                required
                autoFocus
              />
            </label>

            <fieldset className="repo-settings-scope-grid pat-scope-grid" aria-label="Token scopes">
              <legend>Scopes</legend>
              <p className="muted pat-scope-summary">{describeScopeSelection(scopes)}</p>
              {scopeOptions.map((scopeOption) => {
                const checked = scopes.includes(scopeOption.value);
                return (
                  <label
                    key={scopeOption.value}
                    className={`repo-settings-scope-option pat-scope-option ${checked ? 'is-selected' : ''}`}
                  >
                    <input
                      className="pat-scope-check"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleScope(scopeOption.value)}
                    />
                    <span className="pat-scope-state" aria-hidden="true">
                      {checked ? 'Selected' : 'Optional'}
                    </span>
                    <span className="pat-scope-copy">
                      <strong className="pat-scope-name">{scopeOption.label}</strong>
                      <small className="muted">{scopeOption.hint}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <label className="field">
              <span>Expires in</span>
              <select
                value={expiryPreset}
                onChange={(event) => setExpiryPreset(event.target.value as ExpiryPreset)}
                aria-label="Token expiry"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="none">No expiry</option>
              </select>
            </label>

            {formError ? <p className="error">{formError}</p> : null}

            <InlineFormRow className="pat-create-actions">
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create token'}
              </Button>
              <Button type="button" variant="ghost" onClick={closeCreateModal}>
                Cancel
              </Button>
            </InlineFormRow>
          </form>
        )}
      </Modal>

      <Modal
        open={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        title={selectedToken ? `Token details: ${selectedToken.name}` : 'Token details'}
        closeLabel="Close token details dialog"
      >
        {selectedToken ? (
          <div className="stack">
            <p className="muted">Prefix: {selectedToken.tokenPrefix}</p>
            <p className="muted">Scopes: {selectedToken.scopes.join(', ') || '--'}</p>
            <p className="muted">Created: {formatDate(selectedToken.createdAt)}</p>
            <p className="muted">Updated: {formatDate(selectedToken.updatedAt)}</p>
            <p className="muted">Expires: {formatDate(selectedToken.expiresAt)}</p>
            <p className="muted">Last used: {formatDate(selectedToken.lastUsedAt)}</p>
            <p className="muted">Status: {getStatus(selectedToken)}</p>
            {detailsTokenValue ? (
              <label className="field">
                <span>Token value</span>
                <input
                  type="text"
                  readOnly
                  value={detailsTokenValue}
                  className="repo-settings-token-preview"
                />
              </label>
            ) : (
              <p className="muted">
                Full token value is not stored server-side and cannot be shown again for older tokens.
                Create a new token if you need a fresh copy.
              </p>
            )}
            {detailsTokenValue ? (
              <InlineFormRow className="pat-details-actions">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => handleCopyText(detailsTokenValue, 'Token copied to clipboard.')}
                >
                  Copy token
                </Button>
              </InlineFormRow>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={isRevokeOpen}
        onClose={() => {
          if (!isRevoking) {
            setIsRevokeOpen(false);
          }
        }}
        title="Revoke token"
        subtitle="Revoking a PAT will immediately disable operations that used the token."
        closeLabel="Close revoke token dialog"
      >
        {selectedToken ? (
          <div className="stack">
            <p>
              Revoke <strong>{selectedToken.name}</strong>? This action cannot be undone.
            </p>
            <InlineFormRow>
              <Button type="button" variant="danger" onClick={handleRevoke} disabled={isRevoking}>
                {isRevoking ? 'Revoking...' : 'Revoke token'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsRevokeOpen(false)} disabled={isRevoking}>
                Cancel
              </Button>
            </InlineFormRow>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
