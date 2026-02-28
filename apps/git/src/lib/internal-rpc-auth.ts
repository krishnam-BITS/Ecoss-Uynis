import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) {
    return false;
  }
  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  return false;
}

function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1';
}

function normalizeHostHeader(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value.trim().toLowerCase();
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getInternalRpcTokens(): string[] {
  const tokens = [
    process.env.INTERNAL_RPC_TOKEN?.trim() ?? '',
    process.env.INTERNAL_RPC_TOKEN_NEXT?.trim() ?? '',
  ].filter(Boolean);
  if (!tokens.length) {
    throw new Error('INTERNAL_RPC_TOKEN is required for internal RPC.');
  }
  return [...new Set(tokens)];
}

export function verifyInternalRpcRequest(request: FastifyRequest): { ok: true } | { ok: false; reason: string } {
  const expectedTokens = getInternalRpcTokens();
  const incomingToken = String(request.headers['x-internal-token'] ?? '').trim();
  const hasMatchingToken = incomingToken
    ? expectedTokens.some((expectedToken) => secureEqual(incomingToken, expectedToken))
    : false;
  if (!hasMatchingToken) {
    return { ok: false, reason: 'Invalid internal token.' };
  }

  const hostHeader = normalizeHostHeader(
    typeof request.headers.host === 'string' ? request.headers.host : undefined,
  );
  const hostAllowList = (process.env.INTERNAL_RPC_ALLOWED_HOSTS ?? 'git-storage:4001,uynis-git-storage:4001')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!hostAllowList.includes(hostHeader)) {
    return { ok: false, reason: 'Invalid internal host header.' };
  }

  const rawIp = request.ip ?? '';
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
  if (!isPrivateIpv4(ip) && !isLoopbackIp(ip)) {
    return {
      ok: false,
      reason: 'Internal RPC is restricted to private network and loopback clients.',
    };
  }

  return { ok: true };
}
