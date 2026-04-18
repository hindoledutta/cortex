import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.workspace.upsert({
    where: { name: 'work' },
    update: {},
    create: { name: 'work', isDefault: true },
  });
  await prisma.workspace.upsert({
    where: { name: 'personal' },
    update: {},
    create: { name: 'personal', isDefault: false },
  });
  console.log('Seeded workspaces: work (default), personal');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
