import type { FastifyInstance } from 'fastify';

export async function notificationRoutes(server: FastifyInstance) {
  server.get('/notifications', async (_request, reply) => {
    return reply.code(501).send({
      message: 'Notifications are served via /me/notifications endpoints.',
    });
  });
}
