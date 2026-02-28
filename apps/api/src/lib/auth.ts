import type { FastifyRequest } from 'fastify';

type JwtError = Error & { code?: string };

export async function requireAuthenticatedUserId(
  request: FastifyRequest,
): Promise<string> {
  if (request.pat?.userId) {
    return request.pat.userId;
  }

  await request.jwtVerify();
  return request.user.sub;
}

export async function getOptionalUserId(
  request: FastifyRequest,
): Promise<string | null> {
  if (request.pat?.userId) {
    return request.pat.userId;
  }

  try {
    await request.jwtVerify();
    return request.user.sub;
  } catch (error) {
    const jwtError = error as JwtError;
    if (jwtError?.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      return null;
    }
    if (typeof jwtError?.code === 'string' && jwtError.code.startsWith('FST_JWT_')) {
      return null;
    }
    throw error;
  }
}
