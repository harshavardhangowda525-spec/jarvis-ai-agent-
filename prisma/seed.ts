/**
 * Optional seed: creates a demo user so you can sign in immediately in a fresh
 * environment. Safe to run repeatedly (idempotent). Never used in production.
 *
 *   npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@jarvis.ai";
  const password = "demopassword123";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Demo user already exists: ${email}`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      profile: { create: { displayName: "Demo", assistantName: "JARVIS" } },
      voicePreference: { create: {} },
      memories: {
        create: [{ content: "The user is evaluating JARVIS.", source: "agent" }],
      },
    },
  });
  console.log(`Seeded demo user:\n  email: ${email}\n  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
