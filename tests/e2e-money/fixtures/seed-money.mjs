import bcrypt from "bcrypt";
import { prisma } from "./db.mjs";
import { getRunId, taggedEmail } from "./run-id.mjs";

/**
 * The world each scenario books against.
 *
 * Everything here is created fresh and tagged with the run id, never reused
 * from existing dev data. Two reasons, both learned the hard way in this
 * codebase:
 *
 *   Booking against a colleague's workshop session consumes a real seat and
 *   can trip the capacity guards or the waiting-list notifications.
 *
 *   Assertions have to be able to say "the one reservation for this session"
 *   without a stray row from last week making that ambiguous.
 *
 * `prisma/seed-demo.mjs` covers staff, services and products for ordinary
 * development; it deliberately does not create workshops or formations, so
 * those are built here.
 */

const CUSTOMER_PASSWORD = "E2eMoney!2026";

/** Far enough out that the 48-hour cancellation window is never the reason a test fails. */
function farFutureDate(daysAhead = 45) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(10, 0, 0, 0);
  return date;
}

/** Inside the 48-hour window, for the scenarios that must be refused. */
export function insideCancellationWindowDate() {
  const date = new Date();
  date.setHours(date.getHours() + 24);
  return date;
}

/**
 * `User.phone` carries a partial unique index — active users only, but still
 * enforced (migrations/20260817153631_active_only_uniqueness/migration.sql)
 * — so every seeded customer needs a phone number nobody else's run could
 * also pick. Derived rather than random, so a failed run's leftover row is
 * easy to recognise by its phone number too, not only its e-mail.
 */
function tagPhone(tag) {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `04${String(hash % 100_000_000).padStart(8, "0")}`;
}

/**
 * @param {{ label?: string, withAddress?: boolean }} [options] `withAddress:
 *   false` seeds an account the way one predating the mandatory-address field
 *   looks today (see the User.addressLine1 field comment in schema.prisma) —
 *   for exercising the same assertBuyerLegalDataComplete gate a brand-new
 *   guest checkout hits (F1), without needing to drive the guest
 *   email-verification detour just to reach it.
 */
export async function seedCustomer({ label = "customer", withAddress = true } = {}) {
  // No digits, no run id: fullNameSchema (lib/validations/customer-identity.js)
  // rejects any digit outright with its own dedicated message, precisely
  // because a name like "User122" used to pass signup and only fail later,
  // invisibly, the first time the account tried to book anything (see that
  // file's comment on the 2026-08-31 incident). A generated run id is
  // exactly that shape, so it cannot go into fullName — the run is still
  // traceable through the tagged e-mail and phone. Checked here, not just in
  // a comment, because a label as innocuous-looking as "b2b" trips this too
  // (this fixture has produced that exact confusing failure — a UI error
  // three steps into a booking flow instead of a clear one here — twice).
  if (/\d/.test(label)) {
    throw new Error(`seedCustomer: label "${label}" contains a digit, which fullNameSchema rejects. Use a label with no digits.`);
  }

  const runId = getRunId();
  const email = taggedEmail(label, runId);

  return prisma.user.create({
    data: {
      fullName: `Client Test Automatise ${label}`,
      email,
      phone: tagPhone(`${runId}:${label}`),
      password: await bcrypt.hash(CUSTOMER_PASSWORD, 12),
      role: "CUSTOMER",
      emailVerified: true,
      isActive: true,
      newsletterSubscribed: false,
      // A complete Belgian address, because a full-price booking runs through
      // assertBuyerLegalDataComplete and fails without one. A particulier
      // still gets no invoice (hasInvoiceableVatIdentity), which is correct.
      ...(withAddress
        ? { addressLine1: "Rue de Test 1", addressCity: "Bruxelles", addressPostalCode: "1000", addressCountry: "BE" }
        : {}),
    },
  });
}

export function customerCredentials(user) {
  return { email: user.email, password: CUSTOMER_PASSWORD };
}

/**
 * An atelier with a 50 % acompte — the deposit split the whole refund design
 * is built around.
 *
 * @param {{ price?: number, capacity?: number, depositPercentage?: number, daysAhead?: number }} [options]
 */
export async function seedWorkshopSession({
  price = 80,
  capacity = 8,
  depositPercentage = 50,
  daysAhead = 45,
} = {}) {
  const runId = getRunId();

  const activity = await prisma.activity.create({
    data: {
      type: "WORKSHOP",
      title: `E2E Atelier ${runId}`,
      description: "Atelier créé automatiquement par la suite money e2e.",
      price,
      duration: 120,
      capacity,
      status: "PUBLISHED",
      depositPercentage,
    },
  });

  const session = await prisma.workshopSession.create({
    data: {
      workshopId: activity.id,
      startDate: farFutureDate(daysAhead),
      capacity,
      status: "SCHEDULED",
    },
  });

  return { activity, session };
}

/**
 * Deletes exactly what one run created, in foreign-key-safe order.
 *
 * Invoices and credit notes are deliberately NOT touched — they carry gapless
 * legal numbers, and removing one punches a hole in a series that then has to
 * be renumbered by hand. They stay, tagged, and are cleaned up (or not) as a
 * conscious decision rather than as a side effect of a test run.
 */
export async function purgeRun(runId = getRunId()) {
  const users = await prisma.user.findMany({
    where: { email: { contains: runId } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  const activities = await prisma.activity.findMany({
    where: { title: { contains: runId } },
    select: { id: true },
  });
  const activityIds = activities.map((activity) => activity.id);

  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        { workshopReservation: { customerId: { in: userIds } } },
        { formationReservation: { customerId: { in: userIds } } },
        { order: { userId: { in: userIds } } },
        { appointment: { userId: { in: userIds } } },
      ],
    },
    select: { id: true },
  });
  const paymentIds = payments.map((payment) => payment.id);

  const deleted = {};
  deleted.refundLegs = (await prisma.refundLeg.deleteMany({
    where: { refundOperation: { paymentId: { in: paymentIds } } },
  })).count;
  deleted.refundOperations = (await prisma.refundOperation.deleteMany({
    where: { paymentId: { in: paymentIds } },
  })).count;
  deleted.transactions = (await prisma.transaction.deleteMany({
    where: { paymentId: { in: paymentIds } },
  })).count;

  return { runId, userIds, activityIds, paymentIds, deleted };
}
