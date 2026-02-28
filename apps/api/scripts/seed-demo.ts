import { prisma } from '@uynis/db';
import { hashPassword } from '../src/lib/password.js';

const demoUsers = [
  {
    email: 'krish.main@uynis.test',
    phone: '+15551230000',
    username: 'krish.main',
    firstName: 'Krish',
    lastName: 'Main',
    dateOfBirth: new Date('2000-02-12'),
    gender: 'Male',
    emailVerified: true,
    phoneVerified: true,
  },
  {
    email: 'krish.alt@uynis.test',
    phone: '+15551230000',
    username: 'krish.alt',
    firstName: 'Krish',
    lastName: 'Alt',
    dateOfBirth: new Date('2000-02-12'),
    gender: 'Male',
    emailVerified: false,
    phoneVerified: true,
  },
  {
    email: 'sona.primary@uynis.test',
    phone: '+15551231111',
    username: 'sona.primary',
    firstName: 'Sona',
    lastName: 'V',
    dateOfBirth: new Date('1998-07-18'),
    gender: 'Female',
    emailVerified: true,
    phoneVerified: true,
  },
  {
    email: 'sona.side@uynis.test',
    phone: '+15551231111',
    username: 'sona.side',
    firstName: 'Sona',
    lastName: 'V',
    dateOfBirth: new Date('1998-07-18'),
    gender: 'Female',
    emailVerified: false,
    phoneVerified: true,
  },
  {
    email: 'rhea.workspace@uynis.test',
    phone: '+15551232222',
    username: 'rhea.workspace',
    firstName: 'Rhea',
    lastName: 'K',
    dateOfBirth: new Date('1996-09-23'),
    gender: 'Female',
    emailVerified: true,
    phoneVerified: false,
  },
  {
    email: 'solo@uynis.test',
    phone: null,
    username: 'solo.user',
    firstName: 'Solo',
    lastName: 'User',
    dateOfBirth: new Date('1995-11-05'),
    gender: 'Non-binary',
    emailVerified: true,
    phoneVerified: false,
  },
];

async function seed() {
  const passwordHash = hashPassword('Uynis@1234');
  for (const user of demoUsers) {
    const isVerified = user.emailVerified || user.phoneVerified;
    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`.trim(),
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        isVerified,
        verificationExpiresAt: null,
      },
      create: {
        email: user.email,
        phone: user.phone,
        username: user.username,
        passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`.trim(),
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        isVerified,
        verificationExpiresAt: null,
      },
    });
  }
}

seed()
  .then(() => {
    console.log('Seeded demo users.');
  })
  .catch((error) => {
    console.error('Failed to seed demo users:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });