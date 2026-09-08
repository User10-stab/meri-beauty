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
 * A formation with a deposit split — the module with no e2e coverage at all.
 *
 * Formations are not ateliers with a different label. Their money policy is
 * the opposite one: `PROJECT_REQUIREMENTS.md` §2 records that **the deposit
 * and the balance are both non-refundable regardless of attendance**, and
 * `cancelFormationReservation` implements exactly that — cancelling refunds
 * nothing unless an admin passes `refundPayment` with a written reason.
 *
 * That policy is also the one §4 flags for legal re-check, which is a good
 * reason to have it pinned by a test: whatever it becomes, somebody should
 * have to change an assertion to change it.
 *
 * PUBLIC rather than PRIVATE: a PRIVATE formation is capped at exactly one
 * seat (enforced in Zod), so it cannot exercise a seat count at all.
 *
 * @param {{ price?: number, capacity?: number, depositPercentage?: number, daysAhead?: number }} [options]
 */
export async function seedFormationSession({
  price = 120,
  capacity = 6,
  depositPercentage = 50,
  daysAhead = 45,
} = {}) {
  const runId = getRunId();

  const formation = await prisma.formation.create({
    data: {
      type: "PUBLIC",
      title: `E2E Formation ${runId}`,
      description: "Formation créée automatiquement par la suite money e2e.",
      price,
      duration: 240,
      capacity,
      status: "PUBLISHED",
      depositPercentage,
    },
  });

  const session = await prisma.formationSession.create({
    data: {
      formationId: formation.id,
      startDate: farFutureDate(daysAhead),
      capacity,
      status: "SCHEDULED",
    },
  });

  return { formation, session, price, depositPercentage };
}

/**
 * A published product with stock, for the boutique checkout.
 *
 * Created fresh rather than picked from the catalogue for the same reason
 * workshops are: buying a colleague's product consumes real stock, and "the
 * one order for this product" has to be unambiguous for the assertions to
 * mean anything.
 *
 * The stock numbers are the point of the boutique scenario. A prepaid order
 * moves them twice — `reservedQuantity` up at checkout, then at fulfilment
 * `stockQuantity` down and `reservedQuantity` back — and a cancellation moves
 * `stockQuantity` back up. None of that happens on an atelier, so none of it
 * is covered by any other scenario here.
 *
 * @param {{ label?: string, price?: number, stockQuantity?: number }} [options]
 */
export async function seedShopProduct({ label = "boutique", price = 32, stockQuantity = 12 } = {}) {
  const runId = getRunId();
  const slug = `e2e-${label}-${runId}`.toLowerCase();

  const product = await prisma.product.create({
    data: {
      name: `E2E Produit ${label} ${runId}`,
      slug,
      description: "Produit créé automatiquement par la suite money e2e.",
      status: "ACTIVE",
      variants: {
        create: {
          name: "Standard",
          sku: `E2E-${runId}-${label}`.toUpperCase(),
          price,
          costPrice: Number((price / 2).toFixed(2)),
          stockQuantity,
          reservedQuantity: 0,
          isActive: true,
        },
      },
    },
    include: { variants: true },
  });

  return { product, variant: product.variants[0], slug, price };
}

/** The two numbers every boutique stock assertion in this suite is about. */
export async function readVariantStock(variantId) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stockQuantity: true, reservedQuantity: true },
  });
  return { stock: variant.stockQuantity, reserved: variant.reservedQuantity };
}

/**
 * An accepted rendez-vous on the one staff member who can actually take
 * money — and deliberately not a seeded one.
 *
 * Appointments are Stripe Connect *direct charges* on the staff member's own
 * connected account, which is the whole reason this scenario exists: it is a
 * different code path from every atelier flow already covered, right through
 * to `charge.refunded` arriving with an `event.account` that has to be
 * matched back to the right staff member.
 *
 * A connected account cannot be invented. `Staff.stripeAccountId` is
 * `@unique`, so a second Staff row cannot even borrow the existing one, and
 * onboarding a fresh Express account is an interactive Stripe flow. So this
 * finds the real onboarded staff member and books against them.
 *
 * Nothing about that staff member is modified. The scenario is therefore
 * whatever their configuration allows — with `depositEnabled: false` that is
 * a full online payment, which is exactly the case worth covering first.
 *
 * The appointment itself is inserted rather than booked through the public
 * wizard: the booking funnel is UI, and what is under test here is the money.
 */
export async function seedConnectAppointment({ customer, daysAhead = 40 } = {}) {
  const staff = await prisma.staff.findFirst({
    where: {
      stripeAccountId: { not: null },
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      isDeleted: false,
    },
    include: {
      user: { select: { fullName: true } },
      staffServices: {
        where: { isActive: true },
        include: { service: { select: { name: true } } },
        orderBy: { price: "desc" },
      },
    },
  });

  if (!staff) {
    throw new Error(
      "No staff member has a Stripe Connect account with charges and payouts enabled. Appointments are " +
        "direct charges on the staff member's own account, so this scenario cannot run without one, and " +
        "one cannot be seeded (Staff.stripeAccountId is unique and Express onboarding is interactive).",
    );
  }

  // Priced services only: several of the seeded StaffService rows are 0 €,
  // which Stripe will not accept as a line item and which would prove nothing
  // about a payment in any case.
  const staffService = staff.staffServices.find((row) => Number(row.price) > 0);
  if (!staffService) {
    throw new Error(
      `Staff ${staff.user?.fullName ?? staff.id} has a connected account but no service priced above 0 €.`,
    );
  }

  const price = Number(staffService.price);
  const duration = staffService.duration > 0 ? staffService.duration : 60;

  // `Appointment_no_overlap` is a Postgres exclusion constraint: this staff
  // member cannot hold two overlapping appointments. Every run books the same
  // person, so collisions are the normal case, not the exception.
  let appointment = null;
  let attempt = 0;
  while (!appointment) {
    const start = new Date();
    start.setDate(start.getDate() + daysAhead);
    start.setHours(10, 0, 0, 0);
    start.setMinutes(start.getMinutes() + attempt * duration);
    const end = new Date(start.getTime() + duration * 60 * 1000);

    try {
      appointment = await prisma.appointment.create({
        data: {
          userId: customer.id,
          staffServiceId: staffService.id,
          staffId: staff.id,
          date: start,
          startTime: start,
          endTime: end,
          // ACCEPTED is where the salon has said yes and the customer has not
          // yet paid — the exact state /appointment/[id]/payment exists for.
          status: "ACCEPTED",
        },
      });
    } catch (error) {
      if (!/Appointment_no_overlap|23P01/.test(error.message ?? "") || attempt >= 20) throw error;
      attempt += 1;
    }
  }

  return { staff, staffService, appointment, price, serviceName: staffService.service.name };
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
