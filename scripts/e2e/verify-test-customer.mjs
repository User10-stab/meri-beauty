import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
const allowed = email?.endsWith("@example.com") || email?.endsWith("@test.invalid");

if (process.env.NODE_ENV === "production") {
  throw new Error("This E2E helper is disabled in production.");
}
if (process.env.E2E_ALLOW_TEST_EMAIL_VERIFICATION !== "true") {
  throw new Error("Set E2E_ALLOW_TEST_EMAIL_VERIFICATION=true explicitly to use this helper.");
}
if (!email || !allowed) {
  throw new Error("Only synthetic @example.com or @test.invalid addresses are accepted.");
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.update({
    where: { email },
    data: { emailVerified: true, isActive: true },
    select: { id: true, email: true, emailVerified: true },
  });
  const resume = await prisma.emailVerificationToken.findFirst({
    where: { email },
    orderBy: { expiresAt: "desc" },
    select: { resumeType: true, resumeId: true, expiresAt: true },
  });
  console.log(JSON.stringify({ user, resume }));
} finally {
  await prisma.$disconnect();
}
