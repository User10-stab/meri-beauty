import { prisma } from "@/lib/prisma";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 180;

export function getHourlyLimit() {
  const value = Number(process.env.EMAIL_HOURLY_LIMIT);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

async function databaseTime(db) {
  const [{ now }] = await db.$queryRaw`SELECT clock_timestamp() AS now`;
  return now;
}

export async function remainingQuota() {
  if (process.env.EMAIL_PROVIDER === "mailpit") return getHourlyLimit();
  const now = await databaseTime(prisma);
  const used = await prisma.smtpQuotaReservation.count({ where: { expiresAt: { gt: now } } });
  return Math.max(0, getHourlyLimit() - used);
}

// The deployment shares one SMTP budget. The transaction lock serializes
// admission across campaigns, transactional sends, and server processes.
export async function reserveSmtpQuota() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(604190271)`;
    const now = await databaseTime(tx);
    await tx.smtpQuotaReservation.deleteMany({ where: { expiresAt: { lte: now } } });
    const used = await tx.smtpQuotaReservation.count();
    const limit = getHourlyLimit();
    if (used >= limit) {
      const next = await tx.smtpQuotaReservation.findFirst({
        orderBy: { expiresAt: "asc" },
        skip: used - limit,
      });
      // In-flight reservations may shorten when their SMTP calls settle.
      const retryAt = +next.expiresAt > +now + HOUR_MS
        ? new Date(+now + 5 * 60_000)
        : next.expiresAt;
      return { retryAt };
    }

    // Hold an in-flight submission until its outcome is recorded. A crashed
    // sender leaves a conservative two-hour reservation that expires on its own.
    return tx.smtpQuotaReservation.create({
      data: { expiresAt: new Date(now.getTime() + 2 * HOUR_MS) },
      select: { id: true },
    });
  }, { isolationLevel: "ReadCommitted" });
}

export async function finishSmtpQuota(id, submitted) {
  if (!submitted) {
    await prisma.smtpQuotaReservation.delete({ where: { id } });
    return;
  }
  const now = await databaseTime(prisma);
  await prisma.smtpQuotaReservation.update({
    where: { id },
    data: { expiresAt: new Date(now.getTime() + HOUR_MS) },
  });
}
