type CounterLabels = Record<string, string | number | boolean | null | undefined>;

type HistogramBucket = {
  le: number;
  count: number;
};

type HistogramMetric = {
  name: string;
  help: string;
  buckets: HistogramBucket[];
  count: number;
  sum: number;
};

const counters = new Map<string, number>();
const histograms = new Map<string, HistogramMetric>();

function normalizeLabelValue(value: string | number | boolean | null | undefined) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value);
}

function formatLabelKey(labels?: CounterLabels) {
  if (!labels) {
    return '';
  }
  const entries = Object.entries(labels)
    .map(([key, value]) => [key, normalizeLabelValue(value)] as const)
    .filter(([, value]) => value.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (!entries.length) {
    return '';
  }
  return `{${entries
    .map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`)
    .join(',')}}`;
}

function counterMapKey(name: string, labels?: CounterLabels) {
  return `${name}${formatLabelKey(labels)}`;
}

function ensureHistogram(name: string, help: string, bucketBounds: number[]) {
  const existing = histograms.get(name);
  if (existing) {
    return existing;
  }
  const buckets = [...bucketBounds]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
    .map((value) => ({ le: value, count: 0 }));
  const histogram: HistogramMetric = {
    name,
    help,
    buckets,
    count: 0,
    sum: 0,
  };
  histograms.set(name, histogram);
  return histogram;
}

function incrementCounter(name: string, labels?: CounterLabels, value = 1) {
  const key = counterMapKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + value);
}

function observeHistogram(name: string, valueSeconds: number) {
  const histogram = ensureHistogram(name, '', []);
  histogram.count += 1;
  histogram.sum += valueSeconds;
  for (const bucket of histogram.buckets) {
    if (valueSeconds <= bucket.le) {
      bucket.count += 1;
    }
  }
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}) {
  incrementCounter('uynis_http_requests_total');
  incrementCounter('uynis_http_requests_total', {
    method: input.method.toUpperCase(),
    route: input.route,
    status: input.statusCode,
  });
  if (input.statusCode >= 500) {
    incrementCounter('uynis_http_errors_total');
    incrementCounter('uynis_http_errors_total', {
      method: input.method.toUpperCase(),
      route: input.route,
      status: input.statusCode,
    });
  }
  observeHistogram('uynis_http_request_duration_seconds', input.durationSeconds);
}

export function recordRedisCacheResult(result: 'hit' | 'miss') {
  incrementCounter('uynis_redis_cache_total', { result });
}

export function recordGitRpcLatency(durationSeconds: number) {
  observeHistogram('uynis_git_rpc_latency_seconds', durationSeconds);
}

export function recordOpenSearchLatency(durationSeconds: number) {
  observeHistogram('uynis_opensearch_query_latency_seconds', durationSeconds);
}

export function recordWorkerJobResult(result: 'processed' | 'failed' | 'retried') {
  incrementCounter('uynis_worker_jobs_total', { result });
}

const defaultLatencyBuckets = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
];

incrementCounter('uynis_http_requests_total', undefined, 0);
incrementCounter('uynis_http_errors_total', undefined, 0);
incrementCounter('uynis_redis_cache_total', { result: 'hit' }, 0);
incrementCounter('uynis_redis_cache_total', { result: 'miss' }, 0);
incrementCounter('uynis_worker_jobs_total', { result: 'processed' }, 0);
incrementCounter('uynis_worker_jobs_total', { result: 'retried' }, 0);
incrementCounter('uynis_worker_jobs_total', { result: 'failed' }, 0);

ensureHistogram(
  'uynis_http_request_duration_seconds',
  'HTTP request duration in seconds.',
  defaultLatencyBuckets,
);
ensureHistogram(
  'uynis_git_rpc_latency_seconds',
  'Latency of API -> git-storage internal RPC calls in seconds.',
  defaultLatencyBuckets,
);
ensureHistogram(
  'uynis_opensearch_query_latency_seconds',
  'Latency of OpenSearch queries in seconds.',
  defaultLatencyBuckets,
);

function serializeCounter(name: string, help: string, keys: string[]) {
  const lines: string[] = [];
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} counter`);
  for (const key of keys) {
    const value = counters.get(key) ?? 0;
    lines.push(`${key} ${value}`);
  }
  return lines;
}

function serializeHistogram(metric: HistogramMetric) {
  const lines: string[] = [];
  lines.push(`# HELP ${metric.name} ${metric.help}`);
  lines.push(`# TYPE ${metric.name} histogram`);
  for (const bucket of metric.buckets) {
    lines.push(`${metric.name}_bucket{le="${bucket.le}"} ${bucket.count}`);
  }
  lines.push(`${metric.name}_bucket{le="+Inf"} ${metric.count}`);
  lines.push(`${metric.name}_sum ${metric.sum}`);
  lines.push(`${metric.name}_count ${metric.count}`);
  return lines;
}

export function renderPrometheusMetrics() {
  const lines: string[] = [];

  const groups = new Map<string, string[]>();
  for (const key of counters.keys()) {
    const name = key.split('{')[0];
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name)?.push(key);
  }

  const counterHelp: Record<string, string> = {
    uynis_http_requests_total: 'Total HTTP requests handled by API.',
    uynis_http_errors_total: 'Total HTTP 5xx responses.',
    uynis_redis_cache_total: 'Redis cache hit/miss counters.',
    uynis_worker_jobs_total: 'Worker job outcomes.',
  };

  for (const [name, keys] of groups.entries()) {
    lines.push(
      ...serializeCounter(
        name,
        counterHelp[name] ?? `${name} counter.`,
        keys.sort(),
      ),
    );
  }

  for (const metric of histograms.values()) {
    lines.push(...serializeHistogram(metric));
  }

  return `${lines.join('\n')}\n`;
}
