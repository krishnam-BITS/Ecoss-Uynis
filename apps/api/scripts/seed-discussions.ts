import { prisma } from '@uynis/db';

const threadSeeds = [
  {
    id: 'seed-thread-rfc-permissions',
    title: 'RFC: Workspace permission model refresh',
    category: 'RFC',
    status: 'OPEN',
    replies: 12,
    workspaceName: 'Atlas',
    repoName: 'core-platform',
  },
  {
    id: 'seed-thread-design-nav',
    title: 'Design review: repository navigation',
    category: 'DESIGN',
    status: 'ANSWERED',
    replies: 7,
    workspaceName: 'Studio',
    repoName: 'web-client',
  },
  {
    id: 'seed-thread-decision-branch',
    title: 'Decision log: branch protection defaults',
    category: 'DECISION',
    status: 'CLOSED',
    replies: 5,
    workspaceName: 'Atlas',
    repoName: 'devops',
  },
  {
    id: 'seed-thread-question-forks',
    title: 'Question: Notification scope for forks',
    category: 'QUESTION',
    status: 'OPEN',
    replies: 3,
    workspaceName: 'Nova',
    repoName: 'api-gateway',
  },
];

const messageSeeds = [
  {
    id: 'seed-message-design-sync',
    name: 'Design sync',
    preview: 'Shared the latest layout tweaks.',
    members: 4,
    unread: true,
  },
  {
    id: 'seed-message-infra',
    name: 'Infra on-call',
    preview: 'Investigating the alert spike.',
    members: 6,
    unread: false,
  },
  {
    id: 'seed-message-product',
    name: 'Product planning',
    preview: 'Roadmap draft is ready for review.',
    members: 5,
    unread: true,
  },
];

const channelSeeds = [
  {
    id: 'seed-channel-product',
    name: 'product-updates',
    topic: 'Weekly status and launch planning',
    visibility: 'PUBLIC',
    members: 18,
  },
  {
    id: 'seed-channel-infra',
    name: 'infra-alerts',
    topic: 'On-call coordination and incident notes',
    visibility: 'PRIVATE',
    members: 7,
  },
  {
    id: 'seed-channel-design',
    name: 'design-reviews',
    topic: 'Async design critiques and approvals',
    visibility: 'PUBLIC',
    members: 11,
  },
];

const callSeeds = [
  {
    id: 'seed-call-weekly',
    title: 'Weekly planning sync',
    host: 'Krishnam',
    startsAt: new Date(Date.now() + 60 * 60 * 1000),
    status: 'UPCOMING',
    attendees: 9,
  },
  {
    id: 'seed-call-retro',
    title: 'Incident retrospective',
    host: 'Riya',
    startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    status: 'ENDED',
    attendees: 6,
  },
  {
    id: 'seed-call-critique',
    title: 'Design critique',
    host: 'Aman',
    startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    status: 'UPCOMING',
    attendees: 5,
  },
];

async function seed() {
  const user = await prisma.user.findFirst({
    select: { id: true },
  });
  const createdById = user?.id ?? null;

  for (const thread of threadSeeds) {
    await prisma.discussionThread.upsert({
      where: { id: thread.id },
      update: {
        title: thread.title,
        category: thread.category,
        status: thread.status,
        replies: thread.replies,
        workspaceName: thread.workspaceName,
        repoName: thread.repoName,
        createdById,
      },
      create: {
        id: thread.id,
        title: thread.title,
        category: thread.category,
        status: thread.status,
        replies: thread.replies,
        workspaceName: thread.workspaceName,
        repoName: thread.repoName,
        createdById,
      },
    });
  }

  for (const thread of messageSeeds) {
    await prisma.discussionMessageThread.upsert({
      where: { id: thread.id },
      update: {
        name: thread.name,
        preview: thread.preview,
        members: thread.members,
        unread: thread.unread,
        createdById,
      },
      create: {
        id: thread.id,
        name: thread.name,
        preview: thread.preview,
        members: thread.members,
        unread: thread.unread,
        createdById,
      },
    });
  }

  for (const channel of channelSeeds) {
    await prisma.discussionChannel.upsert({
      where: { id: channel.id },
      update: {
        name: channel.name,
        topic: channel.topic,
        visibility: channel.visibility,
        members: channel.members,
        createdById,
      },
      create: {
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        visibility: channel.visibility,
        members: channel.members,
        createdById,
      },
    });
  }

  for (const call of callSeeds) {
    await prisma.discussionCall.upsert({
      where: { id: call.id },
      update: {
        title: call.title,
        host: call.host,
        startsAt: call.startsAt,
        status: call.status,
        attendees: call.attendees,
        createdById,
      },
      create: {
        id: call.id,
        title: call.title,
        host: call.host,
        startsAt: call.startsAt,
        status: call.status,
        attendees: call.attendees,
        createdById,
      },
    });
  }
}

seed()
  .then(() => {
    console.log('Seeded discussions.');
  })
  .catch((error) => {
    console.error('Failed to seed discussions:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
