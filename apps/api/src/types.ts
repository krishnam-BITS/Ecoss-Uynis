import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      jti?: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    pat?: {
      id: string;
      userId: string;
      name: string;
      tokenPrefix: string;
      scopes: string[];
      lastUsedAt: Date | null;
      createdAt: Date;
      expiresAt: Date | null;
      revokedAt: Date | null;
    };
  }
}
