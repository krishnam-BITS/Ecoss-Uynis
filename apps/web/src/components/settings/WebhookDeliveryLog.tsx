'use client';

import { useState } from 'react';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import { Badge, Button, EmptyState } from '../ui';

type Tone = 'success' | 'error' | 'warning' | 'info';

type WebhookDelivery = {
  id: string;
  webhookId: string;
  eventType: string;
  status: 'QUEUED' | 'RUNNING' | 'DELIVERED' | 'FAILED';
  attemptCount: number;
  maxAttempts: number;
  responseStatus?: number | null;
  responseBody?: string | null;
  error?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  webhook?: {
    name?: string | null;
    url?: string | null;
  };
};

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

function compactMessage(value?: string | null) {
  if (!value) {
    return '—';
  }
  if (value.length <= 160) {
    return value;
  }
  return `${value.slice(0, 160)}...`;
}

function normalizeError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unable to load delivery logs.';
}

export function WebhookDeliveryLog({
  workspaceId,
  repoId,
  webhookId,
  onNotify,
}: {
  workspaceId: string;
  repoId: string;
  webhookId: string;
  onNotify?: (message: string, tone?: Tone) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadDeliveries = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ webhookId, limit: '10' });
      const data = await apiFetch<{ deliveries: WebhookDelivery[] }>(
        `/workspaces/${workspaceId}/repos/${repoId}/webhooks/deliveries?${params.toString()}`,
      );
      setDeliveries(data.deliveries);
      setHasLoaded(true);
    } catch (caught) {
      const message = normalizeError(caught);
      if (caught instanceof ApiRequestError && caught.status === 404) {
        setError('Delivery logs are not returned for this repository yet.');
      } else {
        setError(message);
      }
      onNotify?.(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleOpen = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !hasLoaded) {
      await loadDeliveries();
    }
  };

  return (
    <div className="webhook-delivery-log">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-controls={`webhook-deliveries-${webhookId}`}
      >
        {isOpen ? 'Hide deliveries' : 'View deliveries'}
      </Button>

      {isOpen ? (
        <div id={`webhook-deliveries-${webhookId}`} className="webhook-delivery-log-body">
          {isLoading ? <p className="muted">Loading deliveries...</p> : null}
          {!isLoading && error ? <p className="muted">{error}</p> : null}
          {!isLoading && !error && !deliveries.length ? (
            <EmptyState
              title="No deliveries yet."
              description="Delivery logs will appear after the first delivery event."
            />
          ) : null}
          {!isLoading && !error && deliveries.length ? (
            <ul className="webhook-delivery-list">
              {deliveries.map((delivery) => (
                <li key={delivery.id} className="webhook-delivery-item">
                  <div className="webhook-delivery-item-head">
                    <strong>{delivery.eventType}</strong>
                    <Badge
                      className={`webhook-status-dot is-${delivery.status.toLowerCase()}`}
                      tone={
                        delivery.status === 'DELIVERED'
                          ? 'success'
                          : delivery.status === 'FAILED'
                            ? 'danger'
                            : 'warning'
                      }
                      size="sm"
                    >
                      {delivery.status}
                    </Badge>
                  </div>
                  <p className="muted">
                    {formatDate(delivery.deliveredAt ?? delivery.createdAt)} | attempts {delivery.attemptCount}/
                    {delivery.maxAttempts}
                    {typeof delivery.responseStatus === 'number'
                      ? ` | HTTP ${delivery.responseStatus}`
                      : ''}
                  </p>
                  <p className="muted">
                    {compactMessage(delivery.error ?? delivery.responseBody ?? null)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

