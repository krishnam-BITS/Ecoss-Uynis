import type { FastifyInstance } from 'fastify';
import { prisma } from '@uynis/db';
import { getOptionalUserId } from '../lib/auth.js';

export async function usersRoutes(server: FastifyInstance) {
  server.get('/users/:username/public', async (request, reply) => {
    const { username } = request.params as { username: string };
    const normalized = username.trim();
    if (!normalized) {
      return reply.code(400).send({ message: 'Username is required.' });
    }

    const viewerId = await getOptionalUserId(request);

    const user = await prisma.user.findFirst({
      where: {
        username: {
          equals: normalized,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
        name: true,
        avatarUrl: true,
        bio: true,
        location: true,
        website: true,
        createdAt: true,
        personalWorkspace: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    if (!user?.username) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const canSeeAuthRequiredPublicRepos = Boolean(viewerId);
    const repos = user.personalWorkspace
      ? await prisma.repo.findMany({
          where: {
            workspaceId: user.personalWorkspace.id,
            visibility: 'PUBLIC',
            OR: canSeeAuthRequiredPublicRepos
              ? undefined
              : [{ publicReadRequiresAuth: false }],
          },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            name: true,
            slug: true,
            visibility: true,
            publicReadRequiresAuth: true,
            updatedAt: true,
          },
        })
      : [];

    return {
      profile: {
        id: user.id,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        location: user.location,
        website: user.website,
        createdAt: user.createdAt,
      },
      isSelf: viewerId === user.id,
      workspace: user.personalWorkspace
        ? {
            id: user.personalWorkspace.id,
            slug: user.personalWorkspace.slug,
            name: user.personalWorkspace.name,
          }
        : null,
      stats: {
        publicRepoCount: repos.length,
      },
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        slug: repo.slug,
        visibility: repo.visibility,
        publicReadRequiresAuth: repo.publicReadRequiresAuth,
        updatedAt: repo.updatedAt,
        workspaceSlug: user.personalWorkspace?.slug ?? null,
      })),
    };
  });
}
