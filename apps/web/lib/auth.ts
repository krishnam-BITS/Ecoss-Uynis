const TOKEN_KEY = 'uynis_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const storedToken = window.localStorage.getItem(TOKEN_KEY);
  const cookieToken = getTokenFromCookie();

  // Keep both token stores in sync.
  // If cookie is explicitly removed, treat it as a logout signal.
  if (storedToken && !cookieToken) {
    clearToken();
    return null;
  }
  if (!storedToken && cookieToken) {
    window.localStorage.setItem(TOKEN_KEY, cookieToken);
  }

  const token = cookieToken ?? storedToken;
  if (!token) {
    return null;
  }
  if (isTokenExpired(token)) {
    clearToken();
    return null;
  }
  return token;
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, token);
  setTokenCookie(token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(TOKEN_KEY);
  clearTokenCookie();
}

function getTokenFromCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const entry = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${TOKEN_KEY}=`));
  if (!entry) {
    return null;
  }
  const [, value] = entry.split('=');
  return value ? decodeURIComponent(value) : null;
}

function setTokenCookie(token: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
}

function clearTokenCookie(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return false;
    }
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const decoded = JSON.parse(window.atob(payload)) as { exp?: number };
    if (typeof decoded.exp !== 'number') {
      return false;
    }
    return Date.now() >= decoded.exp * 1000;
  } catch {
    return false;
  }
}
