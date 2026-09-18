import bcrypt from "bcrypt";
import { prisma } from "./db.mjs";
import { getRunId, taggedEmail, uniqueSuffix } from "./run-id.mjs";
import Stripe from "stripe";
import { TILL_CASH_OPERATOR_EMAIL } from "../../../lib/authorization.js";

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

/**
 * The only connected account a test-mode key can reach — created, with this
 * same password, by scripts/dev-create-test-connect-account.mjs.
 */
const CONNECT_TEST_ANIMATOR_EMAIL = "e2e.connect.animatrice@meribeauty.test";

/** The same key the run is guarded on — see fixtures/env-guard.mjs. */
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY ?? "").trim());

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
  // Per call, not per run: a recycled worker re-runs beforeAll with the same
  // run id, and a second `e2e+connect-formation.<runId>@…` would fail on
  // User.email. See uniqueSuffix in run-id.mjs.
  const tag = `${label}.${runId}.${uniqueSuffix()}`;
  const email = `e2e+${tag}@meribeauty.test`;

  return prisma.user.create({
    data: {
      fullName: `Client Test Automatise ${label}`,
      email,
      phone: tagPhone(tag),
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
/**
 * The independent an activity can be charged to: INDEPENDENT, not the salon,
 * and her Stripe account ready for a direct charge.
 *
 * Found rather than created, for the same reason seedConnectAppointment finds
 * one: `Staff.stripeAccountId` is unique and Express onboarding is an
 * interactive Stripe flow, so a usable connected account cannot be seeded.
 */
async function findChargeableIndependent() {
  const salonUsers = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: ["ADMIN", "OWNER"] } },
        { email: { equals: TILL_CASH_OPERATOR_EMAIL, mode: "insensitive" } },
      ],
    },
    select: { staff: { select: { id: true } } },
  });
  const salonStaffIds = salonUsers.map((u) => u.staff?.id).filter(Boolean);

  const candidates = await prisma.staff.findMany({
    where: {
      id: { notIn: salonStaffIds },
      type: "INDEPENDENT",
      stripeAccountId: { not: null },
      isDeleted: false,
    },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  // The DB flags are not enough. Every real independent's row says charges and
  // payouts are enabled — and every one of those accounts lives in Stripe
  // **live** mode, invisible to an sk_test_ key. Picking on the flags alone
  // selects one of them and the checkout dies with "The provided key does not
  // have access to account acct_…", which surfaces in the browser as nothing
  // more than "Erreur lors de la création de la session de paiement".
  //
  // So ask Stripe, with the key this run actually uses.
  const reachable = [];
  for (const staff of candidates) {
    const account = await stripe.accounts.retrieve(staff.stripeAccountId).catch(() => null);
    if (account?.charges_enabled && account?.payouts_enabled) return staff;
    if (account) reachable.push(`${staff.user.fullName} (${staff.stripeAccountId}): visible but not chargeable`);
  }

  throw new Error(
    `None of the ${candidates.length} independent staff members' Stripe accounts can be charged with this key.\n` +
      (reachable.length ? `  ${reachable.join("\n  ")}\n` : "  (none of them are even visible to it)\n") +
      "An activity she animates is a direct charge on her own account, so this scenario cannot run without one.\n" +
      "Create a test-mode account with:  node scripts/dev-create-test-connect-account.mjs",
  );
}

/** The Animator row that points at a staff profile — the link payee resolution reads. */
async function animatorForStaff(staff) {
  return prisma.animator.upsert({
    where: { email: staff.user.email },
    update: { name: staff.user.fullName, staffId: staff.id },
    create: { name: staff.user.fullName, email: staff.user.email, staffId: staff.id },
  });
}

/**
 * A formation whose session is animated by an independent, so the seat is
 * charged to HER connected account instead of the salon's.
 *
 * @param {{ price?: number, capacity?: number, depositPercentage?: number, daysAhead?: number }} [options]
 */
export async function seedConnectFormationSession({
  price = 120,
  capacity = 6,
  depositPercentage = 50,
  daysAhead = 46,
} = {}) {
  const runId = getRunId();
  const staff = await findChargeableIndependent();
  const animator = await animatorForStaff(staff);

  const formation = await prisma.formation.create({
    data: {
      type: "PUBLIC",
      title: `E2E Formation Connect ${runId}`,
      description: "Formation animée par une indépendante — suite money e2e.",
      price,
      duration: 240,
      capacity,
      status: "PUBLISHED",
      depositPercentage,
      animatorId: animator.id,
    },
  });

  const session = await prisma.formationSession.create({
    data: {
      formationId: formation.id,
      startDate: farFutureDate(daysAhead),
      capacity,
      status: "SCHEDULED",
      animatorId: animator.id,
    },
  });

  return { formation, session, staff, animator, price, depositPercentage };
}

/**
 * A formation animated by an independent whose Stripe account is NOT ready.
 *
 * Unlike the one above, this staff member IS seeded: an account that cannot
 * charge is exactly one with `stripeAccountId: null`, which carries no unique
 * constraint and needs no Stripe onboarding. Mutating a real connected staff
 * row to fake this would race every other scenario on a shared database.
 */
export async function seedUnreadyIndependentFormationSession({ price = 90, daysAhead = 47 } = {}) {
  const runId = getRunId();
  const email = taggedEmail(`animatrice-sans-stripe.${runId}.${uniqueSuffix()}`);

  const user = await prisma.user.create({
    data: {
      fullName: `E2E Animatrice Sans Stripe ${runId}`,
      email,
      password: await bcrypt.hash(CUSTOMER_PASSWORD, 12),
      phone: `+3299${Date.now().toString().slice(-7)}`,
      role: "STAFF",
      emailVerified: true,
    },
  });
  const staff = await prisma.staff.create({
    // languages/yearsOfExperience are required by the model and irrelevant
    // here — what matters is stripeAccountId staying null, which is what
    // "cannot charge online" actually means.
    data: { userId: user.id, type: "INDEPENDENT", isActive: true, languages: ["fr"], yearsOfExperience: 1 },
  });
  const animator = await prisma.animator.create({
    data: { name: user.fullName, email, staffId: staff.id },
  });

  const formation = await prisma.formation.create({
    data: {
      type: "PUBLIC",
      title: `E2E Formation Sans Stripe ${runId}`,
      price,
      duration: 180,
      capacity: 4,
      status: "PUBLISHED",
      depositPercentage: 50,
      animatorId: animator.id,
    },
  });
  const session = await prisma.formationSession.create({
    data: {
      formationId: formation.id,
      startDate: farFutureDate(daysAhead),
      capacity: 4,
      status: "SCHEDULED",
      animatorId: animator.id,
    },
  });

  return { formation, session, staff, user, animator, price };
}

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
/**
 * How to log in as the independent a Connect scenario picked.
 *
 * Only one account can be picked at all: seedConnectAppointment probes Stripe
 * and keeps the first reachable connected account, and in test mode that is
 * the one scripts/dev-create-test-connect-account.mjs creates — every real
 * practitioner's account is live and invisible to an sk_test_ key. So the
 * password is knowable, because this fixture is the thing that set it.
 *
 * Throws rather than guessing if some other account ever becomes reachable:
 * a wrong password here would surface as "stuck on /login", which reads like
 * a broken login page rather than a fixture that picked an account it has no
 * credentials for.
 */
export function connectStaffCredentials(staff) {
  const email = staff?.user?.email;
  if (email !== CONNECT_TEST_ANIMATOR_EMAIL) {
    throw new Error(
      `This scenario needs to log in as the independent who owns the charge, but it picked ` +
        `"${email ?? "(no e-mail)"}", whose password this suite does not know.
` +
        `Only ${CONNECT_TEST_ANIMATOR_EMAIL} is seeded with one — see scripts/dev-create-test-connect-account.mjs.`,
    );
  }
  return { email, password: CUSTOMER_PASSWORD };
}

export async function seedConnectAppointment({ customer, daysAhead = 40 } = {}) {
  const candidates = await prisma.staff.findMany({
    where: {
      stripeAccountId: { not: null },
      isDeleted: false,
    },
    include: {
      user: { select: { fullName: true, email: true } },
      staffServices: {
        where: { isActive: true },
        include: { service: { select: { name: true } } },
        orderBy: { price: "desc" },
      },
    },
  });

  // Ask Stripe rather than trusting the columns: every real practitioner's row
  // says charges and payouts are enabled, and every one of those accounts is a
  // **live** account that an sk_test_ key cannot even see. Choosing on the
  // flags picks one of them, and the checkout then fails with "The provided
  // key does not have access to account acct_…".
  let staff = null;
  for (const candidate of candidates) {
    const account = await stripe.accounts.retrieve(candidate.stripeAccountId).catch(() => null);
    if (account?.charges_enabled && account?.payouts_enabled) {
      staff = candidate;
      break;
    }
  }

  if (!staff) {
    throw new Error(
      `None of the ${candidates.length} staff members with a Stripe account can be charged with this key — ` +
        "they are live accounts, invisible in test mode. Appointments are direct charges on the practitioner's " +
        "own account, so this scenario cannot run without a reachable one.\n" +
        "Create a test-mode account with:  node scripts/dev-create-test-connect-account.mjs",
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
