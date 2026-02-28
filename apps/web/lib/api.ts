const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type ApiError = {
  message: string;
};

export class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ApiError;
    if (data?.message) {
      return data.message;
    }
  } catch {
    // ignore
  }
  return `Request failed: ${response.status}`;
}

type ApiFetchOptions = RequestInit & {
  suppressAuthRedirect?: boolean;
  cacheTtlMs?: number | false;
};

type CachedResponse = {
  expiresAt: number;
  data: unknown;
};

const apiResponseCache = new Map<string, CachedResponse>();
const apiInFlightCache = new Map<string, Promise<unknown>>();
const DEFAULT_GET_CACHE_TTL_MS = 8_000;

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  const hasBody = typeof options.body !== 'undefined' && options.body !== null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (hasBody && !isFormData && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const { getToken } = await import('./auth');
  const token = getToken();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const method = (options.method ?? 'GET').toUpperCase();
  const shouldCacheGet =
    method === 'GET' && options.cacheTtlMs !== false;
  const cacheTtlMs =
    typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : DEFAULT_GET_CACHE_TTL_MS;
  const cacheKey = shouldCacheGet ? `${token ?? 'anon'}::${path}` : null;

  if (shouldCacheGet && cacheKey) {
    const cachedEntry = apiResponseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.data as T;
    }
    const inflight = apiInFlightCache.get(cacheKey);
    if (inflight) {
      return (await inflight) as T;
    }
  }

  const requestPromise = (async () => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const shouldRedirect =
        response.status === 401 &&
        !options.suppressAuthRedirect &&
        !path.startsWith('/auth');

      if (shouldRedirect) {
        const { clearToken } = await import('./auth');
        clearToken();
        if (typeof window !== 'undefined') {
          window.location.replace('/login');
        }
      }
      const message = await readErrorMessage(response);
      throw new ApiRequestError(response.status, message);
    }

    return (await response.json()) as T;
  })();

  if (shouldCacheGet && cacheKey) {
    apiInFlightCache.set(cacheKey, requestPromise as Promise<unknown>);
  }

  try {
    const data = await requestPromise;
    if (shouldCacheGet && cacheKey) {
      apiResponseCache.set(cacheKey, {
        expiresAt: Date.now() + cacheTtlMs,
        data,
      });
    } else if (method !== 'GET') {
      apiResponseCache.clear();
    }
    return data;
  } finally {
    if (shouldCacheGet && cacheKey) {
      apiInFlightCache.delete(cacheKey);
    }
  }
}
