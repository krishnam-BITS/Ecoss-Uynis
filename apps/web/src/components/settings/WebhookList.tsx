'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import { PortalCardSkeleton } from '../../../components/portal';
import { WebhookDeliveryLog } from './WebhookDeliveryLog';
import {
  Badge,
  Button,
  EmptyState,
  InlineFormRow,
  Modal,
  SectionHeader,
} from '../ui';

type Tone = 'success' | 'error' | 'warning' | 'info';

type WebhookEvent = 'PUSH' | 'ISSUE_CREATED' | 'PULL_OPENED' | 'COMMENT_ADDED';

type RepoWebhook = {
  id: string;
  repoId: string;
  name: string;
  url: string;
  active: boolean;
  events: WebhookEvent[];
  maxAttempts: number;
  timeoutMs: number;
  lastDeliveryAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type WebhookSecretResponse = {
  secret: string;
  record: {
    id: string;
    repoId: string;
    createdAt: string;
    updatedAt: string;
  };
};

type FormMode = 'create' | 'edit';

const eventOptions: Array<{ value: WebhookEvent; label: string; hint: string }> = [
  { value: 'PUSH', label: 'Push', hint: 'Triggered when commits are pushed.' },
  {
    value: 'ISSUE_CREATED',
    label: 'Issue created',
    hint: 'Triggered when a new issue is opened.',
  },
  {
    value: 'PULL_OPENED',
    label: 'Pull request opened',
    hint: 'Triggered when a new pull request is opened.',
  },
  {
    value: 'COMMENT_ADDED',
    label: 'Comment added',
    hint: 'Triggered when comments are created.',
  },
];

const formatDate = (value?: string | null) => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return parsed.toLocaleString();
};

const maskedValue = (input: string) => {
  if (!input) {
    return '••••••••';
  }
  if (input.length <= 8) {
    return '••••••••';
  }
  return `${input.slice(0, 4)}••••••${input.slice(-4)}`;
};

const normalizeError = (error: unknown, fallback: string) => {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const defaultEvents: WebhookEvent[] = ['PUSH'];

function isValidWebhookUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function WebhookList({
  workspaceId,
  repoId,
  canManage,
  onNotify,
}: {
  workspaceId: string;
  repoId: string;
  canManage: boolean;
  onNotify?: (message: string, tone?: Tone) => void;
}) {
  const [webhooks, setWebhooks] = useState<RepoWebhook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(defaultEvents);
  const [maxAttempts, setMaxAttempts] = useState('5');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RepoWebhook | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);

  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [isSecretVisible, setIsSecretVisible] = useState(false);
  const [isRotatingSecret, setIsRotatingSecret] = useState(false);
  const [secretUpdatedAt, setSecretUpdatedAt] = useState<string | null>(null);

  const notify = useCallback(
    (message: string, tone: Tone = 'info') => {
      onNotify?.(message, tone);
    },
    [onNotify],
  );

  const loadWebhooks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{ webhooks: RepoWebhook[] }>(
        `/workspaces/${workspaceId}/repos/${repoId}/webhooks`,
      );
      setWebhooks(data.webhooks);
    } catch (error) {
      notify(normalizeError(error, 'Unable to load webhooks.'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [notify, repoId, workspaceId]);

  useEffect(() => {
    if (!canManage) {
      return;
    }
    void loadWebhooks();
  }, [canManage, loadWebhooks]);

  const resetForm = () => {
    setName('');
    setUrl('');
    setEvents(defaultEvents);
    setMaxAttempts('5');
    setTimeoutMs('10000');
    setActive(true);
    setFormError(null);
    setEditingWebhookId(null);
    setFormMode('create');
  };

  const openCreateForm = () => {
    resetForm();
    setFormMode('create');
    setIsFormOpen(true);
  };

  const openEditForm = (target: RepoWebhook) => {
    setFormMode('edit');
    setEditingWebhookId(target.id);
    setName(target.name);
    setUrl(target.url);
    setEvents(target.events.length ? target.events : defaultEvents);
    setMaxAttempts(String(target.maxAttempts));
    setTimeoutMs(String(target.timeoutMs));
    setActive(target.active);
    setFormError(null);
    setIsFormOpen(true);
  };

  const toggleEvent = (value: WebhookEvent) => {
    setEvents((prev) => {
      if (prev.includes(value)) {
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter((entry) => entry !== value);
      }
      return [...prev, value];
    });
  };

  const submitWebhook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) {
      return;
    }

    const cleanName = name.trim();
    const cleanUrl = url.trim();

    if (!cleanName) {
      setFormError('Webhook name is required.');
      return;
    }
    if (!cleanUrl || !isValidWebhookUrl(cleanUrl)) {
      setFormError('Enter a valid http/https URL.');
      return;
    }
    if (!events.length) {
      setFormError('Select at least one event.');
      return;
    }

    const parsedMaxAttempts = Number.parseInt(maxAttempts, 10);
    const parsedTimeout = Number.parseInt(timeoutMs, 10);

    if (!Number.isFinite(parsedMaxAttempts) || parsedMaxAttempts < 1 || parsedMaxAttempts > 10) {
      setFormError('Max attempts must be between 1 and 10.');
      return;
    }
    if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 60000) {
      setFormError('Timeout must be between 1000 and 60000 ms.');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    try {
      const payload = {
        name: cleanName,
        url: cleanUrl,
        events,
        active,
        maxAttempts: parsedMaxAttempts,
        timeoutMs: parsedTimeout,
      };

      if (formMode === 'create') {
        await apiFetch<{ webhook: RepoWebhook }>(`/workspaces/${workspaceId}/repos/${repoId}/webhooks`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('Webhook created.', 'success');
      } else if (editingWebhookId) {
        await apiFetch<{ webhook: RepoWebhook }>(
          `/workspaces/${workspaceId}/repos/${repoId}/webhooks/${editingWebhookId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        );
        notify('Webhook updated.', 'success');
      }

      setIsFormOpen(false);
      resetForm();
      await loadWebhooks();
    } catch (error) {
      const message = normalizeError(error, 'Unable to save webhook.');
      setFormError(message);
      notify(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (target: RepoWebhook) => {
    if (!canManage) {
      return;
    }
    setIsTogglingId(target.id);
    try {
      await apiFetch<{ webhook: RepoWebhook }>(
        `/workspaces/${workspaceId}/repos/${repoId}/webhooks/${target.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ active: !target.active }),
        },
      );
      setWebhooks((prev) =>
        prev.map((hook) => (hook.id === target.id ? { ...hook, active: !hook.active } : hook)),
      );
      notify(`Webhook ${target.active ? 'disabled' : 'enabled'}.`, 'success');
    } catch (error) {
      notify(normalizeError(error, 'Unable to update webhook.'), 'error');
    } finally {
      setIsTogglingId(null);
    }
  };

  const handleDeleteWebhook = async () => {
    if (!deleteTarget || !canManage) {
      return;
    }
    setIsDeleting(true);
    try {
      await apiFetch<{ deleted: boolean }>(
        `/workspaces/${workspaceId}/repos/${repoId}/webhooks/${deleteTarget.id}`,
        {
          method: 'DELETE',
        },
      );
      setWebhooks((prev) => prev.filter((hook) => hook.id !== deleteTarget.id));
      setDeleteTarget(null);
      notify('Webhook deleted.', 'success');
    } catch (error) {
      notify(normalizeError(error, 'Unable to delete webhook.'), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const rotateSigningSecret = async () => {
    if (!canManage) {
      return;
    }
    setIsRotatingSecret(true);
    try {
      const data = await apiFetch<WebhookSecretResponse>(
        `/workspaces/${workspaceId}/repos/${repoId}/webhook-secret`,
        {
          method: 'POST',
        },
      );
      setSigningSecret(data.secret);
      setSecretUpdatedAt(data.record.updatedAt);
      setIsSecretVisible(false);
      notify('Signing secret rotated. Copy it now.', 'success');
    } catch (error) {
      notify(normalizeError(error, 'Unable to rotate signing secret.'), 'error');
    } finally {
      setIsRotatingSecret(false);
    }
  };

  const copySecret = async () => {
    if (!signingSecret) {
      return;
    }
    try {
      await navigator.clipboard.writeText(signingSecret);
      notify('Signing secret copied.', 'success');
    } catch {
      notify('Unable to copy signing secret.', 'error');
    }
  };

  const webhookCountLabel = useMemo(() => `${webhooks.length} webhook${webhooks.length === 1 ? '' : 's'}`, [webhooks.length]);

  return (
    <section className="repo-settings-panel" aria-labelledby="webhooks-heading">
      <SectionHeader
        title={<span id="webhooks-heading">Webhooks</span>}
        subtitle="Manage outbound webhook endpoints for push, issue, pull request, and comment events."
        actions={
          <InlineFormRow align="center" className="repo-settings-panel-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={rotateSigningSecret}
              disabled={!canManage || isRotatingSecret}
              aria-label="Rotate webhook signing secret"
            >
              {isRotatingSecret ? 'Rotating secret...' : 'Rotate secret'}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={openCreateForm}
              disabled={!canManage}
              aria-label="Create repository webhook"
            >
              Create webhook
            </Button>
          </InlineFormRow>
        }
      />

      <p className="muted repo-settings-help">{webhookCountLabel}</p>

      {signingSecret ? (
        <div className="webhook-secret-row" role="status" aria-live="polite">
          <div className="webhook-secret-main">
            <strong>Repository signing secret</strong>
            <p className="muted">
              {isSecretVisible ? signingSecret : maskedValue(signingSecret)}
              {secretUpdatedAt ? ` | updated ${formatDate(secretUpdatedAt)}` : ''}
            </p>
          </div>
          <div className="webhook-secret-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsSecretVisible((prev) => !prev)}>
              {isSecretVisible ? 'Hide' : 'Reveal'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={copySecret}>
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      {!canManage ? (
        <p className="muted">You need admin access to manage repository webhooks.</p>
      ) : isLoading ? (
        <PortalCardSkeleton lines={4} />
      ) : webhooks.length ? (
        <ul className="webhook-list">
          {webhooks.map((hook) => (
            <li key={hook.id} className="webhook-row">
              <div className="webhook-row-main">
                <div className="webhook-row-head">
                  <strong>{hook.name}</strong>
                  <Badge
                    className={`webhook-status-dot is-${hook.active ? 'active' : 'inactive'}`}
                    tone={hook.active ? 'success' : 'warning'}
                    size="sm"
                  >
                    {hook.active ? 'Active' : 'Paused'}
                  </Badge>
                </div>
                <p className="muted webhook-url" title={hook.url}>{hook.url}</p>
                <div className="webhook-events" aria-label="Webhook events">
                  {hook.events.map((eventName) => (
                    <span key={eventName} className="webhook-event-pill">
                      {eventName}
                    </span>
                  ))}
                </div>
                <p className="muted webhook-meta">
                  Last delivery: {formatDate(hook.lastDeliveryAt)} | Retries: {hook.maxAttempts} | Timeout:{' '}
                  {hook.timeoutMs}ms
                </p>
                <WebhookDeliveryLog
                  workspaceId={workspaceId}
                  repoId={repoId}
                  webhookId={hook.id}
                  onNotify={onNotify}
                />
              </div>
              <div className="webhook-row-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleActive(hook)}
                  disabled={isTogglingId === hook.id}
                  aria-label={hook.active ? 'Disable webhook' : 'Enable webhook'}
                >
                  {isTogglingId === hook.id ? 'Saving...' : hook.active ? 'Disable' : 'Enable'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => openEditForm(hook)}>
                  Edit
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={() => setDeleteTarget(hook)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No webhooks configured yet."
          description="Create one to deliver push, issue, pull request, and comment events."
        />
      )}

      <Modal
        open={isFormOpen}
        onClose={() => {
          if (!isSaving) {
            setIsFormOpen(false);
          }
        }}
        title={formMode === 'create' ? 'Create webhook' : 'Edit webhook'}
        closeLabel="Close webhook form dialog"
      >
        <form className="stack" onSubmit={submitWebhook}>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="CI notifications"
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Endpoint URL</span>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhooks/uynis"
              required
            />
          </label>

          <fieldset className="repo-settings-scope-grid" aria-label="Webhook events">
            <legend>Events</legend>
            {eventOptions.map((eventOption) => (
              <label key={eventOption.value} className="repo-settings-scope-option">
                <input
                  type="checkbox"
                  checked={events.includes(eventOption.value)}
                  onChange={() => toggleEvent(eventOption.value)}
                />
                <span>
                  <strong>{eventOption.label}</strong>
                  <small className="muted">{eventOption.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="repo-settings-form-grid">
            <label className="field">
              <span>Max attempts</span>
              <input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Timeout (ms)</span>
              <input
                type="number"
                min={1000}
                max={60000}
                step={500}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </label>
          </div>

          <label className="toggle-row">
            <span>
              <strong>Webhook active</strong>
              <small className="muted">Disable to stop deliveries temporarily.</small>
            </span>
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          </label>

          {formError ? <p className="error">{formError}</p> : null}

          <InlineFormRow>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : formMode === 'create' ? 'Create webhook' : 'Save changes'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
          </InlineFormRow>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!isDeleting) {
            setDeleteTarget(null);
          }
        }}
        title="Delete webhook"
        subtitle="This permanently removes the webhook and stops future deliveries."
        closeLabel="Close delete webhook dialog"
      >
        {deleteTarget ? (
          <div className="stack">
            <p>
              Delete <strong>{deleteTarget.name}</strong>?
            </p>
            <InlineFormRow>
              <Button type="button" variant="danger" onClick={handleDeleteWebhook} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete webhook'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                Cancel
              </Button>
            </InlineFormRow>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

