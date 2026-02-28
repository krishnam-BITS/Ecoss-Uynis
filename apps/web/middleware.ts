import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set([
  '/',
  '/home',
  '/login',
  '/signup',
  '/help',
  '/terms',
  '/forgot-id',
  '/forgot-password',
  '/private',
]);
const PUBLIC_REPO_PATH =
  /^\/workspaces\/[^/]+\/repos\/[^/]+(?:\/(issues|pulls)(?:\/[^/]+)?)?$/;
const PUBLIC_WORKSPACE_PATH = /^\/workspaces\/[^/]+$/;
const PUBLIC_WORKSPACE_REPOS_PATH = /^\/workspaces\/[^/]+\/repos$/;
const PUBLIC_INVITE_PATH = /^\/invites\/[^/]+$/;
const RESERVED_PUBLIC_PROFILE_SEGMENTS = new Set([
  'home',
  'login',
  'signup',
  'help',
  'terms',
  'forgot-id',
  'forgot-password',
  'private',
  'dashboard',
  'activity',
  'issues',
  'pulls',
  'repositories',
  'workspaces',
  'workspace',
  'notifications',
  'settings',
  'tasks',
  'discussions',
  'projects',
  'logs',
  'invites',
  'api',
  'uploads',
  'docs',
  'search',
]);

function isPublicProfilePath(pathname: string): boolean {
  if (!/^\/[^/]+$/.test(pathname)) {
    return false;
  }
  const segment = pathname.slice(1).toLowerCase();
  if (!segment) {
    return false;
  }
  return !RESERVED_PUBLIC_PROFILE_SEGMENTS.has(segment);
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return false;
    }
    const normalized = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(normalized)) as { exp?: number };
    if (typeof parsed.exp !== 'number') {
      return false;
    }
    return Date.now() >= parsed.exp * 1000;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/assets')
  ) {
    return NextResponse.next();
  }

  const rawToken = request.cookies.get('uynis_token')?.value;
  const tokenExpired = rawToken ? isTokenExpired(rawToken) : false;
  const hasToken = Boolean(rawToken) && !tokenExpired;

  const isPublicRepoPath = PUBLIC_REPO_PATH.test(pathname);
  const isPublicWorkspacePath = PUBLIC_WORKSPACE_PATH.test(pathname);
  const isPublicWorkspaceReposPath = PUBLIC_WORKSPACE_REPOS_PATH.test(pathname);
  const isPublicInvitePath = PUBLIC_INVITE_PATH.test(pathname);
  const isPublicProfile = isPublicProfilePath(pathname);

  if (
    !hasToken &&
    !PUBLIC_PATHS.has(pathname) &&
    !isPublicRepoPath &&
    !isPublicWorkspacePath &&
    !isPublicWorkspaceReposPath &&
    !isPublicInvitePath &&
    !isPublicProfile
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('from', pathname);
    const response = NextResponse.redirect(loginUrl);
    if (tokenExpired) {
      response.cookies.delete('uynis_token');
    }
    return response;
  }

  if (
    hasToken &&
    PUBLIC_PATHS.has(pathname) &&
    pathname !== '/home' &&
    pathname !== '/' &&
    pathname !== '/help' &&
    pathname !== '/terms'
  ) {
    const portalUrl = request.nextUrl.clone();
    portalUrl.pathname = '/';
    return NextResponse.redirect(portalUrl);
  }

  if (tokenExpired) {
    const response = NextResponse.next();
    response.cookies.delete('uynis_token');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};
