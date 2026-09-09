import bcrypt from "bcrypt";
import { prisma } from "../../e2e-money/fixtures/db.mjs";
import { getRunId, taggedEmail } from "../../e2e-money/fixtures/run-id.mjs";

/**
 * The people and documents the permission scenarios need.
 *
 * Everything is created fresh and tagged with the run id, never borrowed from
 * existing dev rows. For an authorisation suite that is not tidiness, it is
 * the whole method: the only way to prove "a staff member with exactly
 * ORDERS and nothing else is refused here" is to own a staff member whose
 * permission array you wrote yourself. Reusing a colleague's staff row would
 * silently test whatever permissions they happen to hold today.
 */

export const STAFF_PASSWORD = "E2eDash!2026";

/** Same partial-unique-index dance as the money suite's seedCustomer. */
export function tagPhone(tag) {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `04${String(hash % 100_000_000).padStart(8, "0")}`;
}

/**
 * A staff member holding exactly the permissions asked for — no more.
 *
 * Note the explicit `dashboardPermissions`: the schema default grants seven
 * of them, so omitting the field would hand every seeded staff member
 * APPOINTMENTS, SERVICES, CUSTOMERS, FORMATIONS, FORMATION_RESERVATIONS,
 * WORKSHOP_RESERVATIONS and NEWSLETTER, and every "is this refused?"
 * assertion would be testing the wrong subject. Passing `[]` is meaningful
 * and must stay possible, which is why there is no `?? DEFAULTS` here.
 *
 * @param {{ label: string, permissions: string[] }} input
 */
export async function seedStaff({ label, permissions }) {
  if (/\d/.test(label)) {
    // fullNameSchema rejects digits outright (lib/validations/customer-identity.js).
    throw new Error(`seedStaff: label "${label}" contains a digit. Use a label with no digits.`);
  }
  if (!Array.isArray(permissions)) {
    throw new Error("seedStaff: permissions must be an array (pass [] for a staff member with none).");
  }

  const runId = getRunId();
  const email = taggedEmail(`staff.${label}`, runId);

  const user = await prisma.user.create({
    data: {
      fullName: `Staff Test Automatise ${label}`,
      email,
      phone: tagPhone(`${runId}:staff:${label}`),
      password: await bcrypt.hash(STAFF_PASSWORD, 12),
      role: "STAFF",
      emailVerified: true,
      isActive: true,
    },
  });

  const staff = await prisma.staff.create({
    data: {
      userId: user.id,
      type: "EMPLOYEE",
      yearsOfExperience: 1,
      isActive: true,
      dashboardPermissions: permissions,
      setupCompleted: true,
      // Onboarding completeness is *computed*, not read from the column
      // above: checkOnboardingStatus() calls a staff member set up when they
      // have at least one language, one contract and one working hour, and
      // OnboardingGuard then client-side redirects anyone failing that to
      // /dashboard/account-settings from every other page.
      //
      // A staff member seeded without these is therefore bounced out of the
      // very screen a permission test just granted them — and because the
      // guard fires from an effect after a server action, it lands *during*
      // the assertion rather than before it. That produced a permission
      // failure on one route and not another in the same run, which reads
      // exactly like a flaky authorisation bug and is nothing of the sort.
      languages: ["FR"],
      contracts: {
        create: {
          type: "PERCENTAGE",
          commissionPercentage: 50,
          startDate: new Date(),
          status: "ACTIVE",
        },
      },
      workingHours: {
        create: { day: "MONDAY", startTime: "09:00", endTime: "17:00", isClosed: false },
      },
    },
  });

  return { user, staff, credentials: { email, password: STAFF_PASSWORD } };
}

/**
 * An admin of this suite's own, rather than the shared `admin@meribeauty.com`.
 *
 * Both e2e suites used to sign in as that one account, and
 * `actions/auth/login.js` rate-limits to **10 attempts per email+IP per 5
 * minutes**. That was comfortable while the money suite had four scenarios;
 * at seven it is not, and running the two suites back to back produced
 * exactly one failure in a five-suite sweep that then passed on every
 * isolated re-run — the signature being `1 failed / 3 did not run`, i.e. the
 * whole file aborting in `beforeAll`, which is where it signs in. (T1c.)
 *
 * A per-file admin gives every spec its own rate-limit bucket, so no spec
 * can exhaust another's, and neither suite can exhaust the other's. That
 * removes the coupling rather than working around it with sleeps or ordering
 * rules that quietly stop being true as scenarios are added — which is what
 * happened here.
 *
 * Role ADMIN with no Staff row, which is exactly what the real admin account
 * is (verified, not assumed), so nothing behaves differently:
 * `OnboardingGuard` ignores anyone who is not STAFF, and `isAdminRole` is
 * satisfied by the role alone.
 *
 * @param {{ label: string }} input
 */
export async function seedAdmin({ label }) {
  if (/\d/.test(label)) {
    throw new Error(`seedAdmin: label "${label}" contains a digit. fullNameSchema rejects digits.`);
  }

  const runId = getRunId();
  const email = taggedEmail(`admin.${label}`, runId);

  const user = await prisma.user.create({
    data: {
      fullName: `Admin Test Automatise ${label}`,
      email,
      phone: tagPhone(`${runId}:admin:${label}`),
      password: await bcrypt.hash(STAFF_PASSWORD, 12),
      role: "ADMIN",
      emailVerified: true,
      isActive: true,
    },
  });

  return { user, credentials: { email, password: STAFF_PASSWORD } };
}

/**
 * An appointment invoice belonging to one specific staff member.
 *
 * The dev database has 57 invoices and not one of them is appointment-backed,
 * so the branch that matters most — a staff member may read an appointment
 * invoice only when the appointment is *theirs* — cannot be exercised against
 * existing data.
 *
 * The invoice number is deliberately outside the legal series ("E2E-<run>-…"
 * rather than "2026-000058"). Allocating a real number to prove an access
 * check would consume one out of a gapless sequence that is a Belgian legal
 * requirement, and it would then have to stay forever, exactly as the money
 * suite's do. The route being tested never parses the number, so nothing is
 * weakened by keeping this document out of the books.
 */
/** One service this staff member offers, priced for the scenario. */
export async function createStaffService({ staff, createdByUserId, price = 60 }) {
  const service = await prisma.service.findFirst({ where: { isDeleted: false }, select: { id: true, name: true } });
  if (!service) throw new Error("createStaffService: no Service in the database to attach a StaffService to.");

  // Reused, not blindly created: StaffService is unique on (staffId,
  // serviceId), so a scenario seeding a second appointment for the same staff
  // member hits that constraint — which reads as a database error in the
  // middle of a test rather than as "this person already offers this
  // service", which is all it means.
  const existing = await prisma.staffService.findFirst({
    where: { staffId: staff.id, serviceId: service.id },
  });
  const staffService =
    existing ??
    (await prisma.staffService.create({
      data: {
        staffId: staff.id,
        serviceId: service.id,
        createdById: createdByUserId,
        price,
        duration: 60,
        photo: "/images/placeholder.png",
        isActive: true,
      },
    }));

  return { service, staffService };
}

/**
 * An appointment on a given staff member's book, optionally with money
 * outstanding.
 *
 * `payment: "balanceDue"` reproduces the state completeAppointment guards:
 * a deposit taken online with the rest to settle at the counter. That is the
 * only shape where the "did the money actually arrive?" confirmation applies,
 * because it is the only one where the system has no way to observe the
 * handoff itself.
 *
 * @param {{ hoursFromNow?: number, payment?: "none"|"paid"|"balanceDue" }} options
 */
export async function seedAppointment({
  staff,
  customer,
  createdByUserId,
  hoursFromNow = -2,
  status = "CONFIRMED",
  payment = "none",
  price = 60,
}) {
  const { service, staffService } = await createStaffService({ staff, createdByUserId, price });

  // `Appointment_no_overlap` is a Postgres exclusion constraint: one staff
  // member cannot hold two appointments whose time ranges overlap. That is
  // correct and worth keeping — but it means two scenarios asking for "an
  // appointment 72 hours out" on the same staff member collide with a raw
  // 23P01 in the middle of a test. Shift forward an hour at a time instead;
  // no scenario here cares about the exact slot, only which side of the
  // 48-hour window it falls on, and an hour never crosses that.
  let appointment = null;
  let attempt = 0;
  while (!appointment) {
    const start = new Date(Date.now() + (hoursFromNow + attempt) * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    try {
      appointment = await prisma.appointment.create({
        data: {
          userId: customer.id,
          staffServiceId: staffService.id,
          staffId: staff.id,
          date: start,
          startTime: start,
          endTime: end,
          status,
        },
      });
    } catch (error) {
      const overlapping = /Appointment_no_overlap|23P01/.test(error.message ?? "");
      if (!overlapping || attempt >= 8) throw error;
      attempt += 1;
    }
  }

  let paymentRow = null;
  if (payment === "balanceDue") {
    const deposit = Number((price / 2).toFixed(2));
    paymentRow = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        totalAmount: price,
        paidAmount: deposit,
        remainingAmount: Number((price - deposit).toFixed(2)),
        depositAmount: deposit,
        paymentType: "DEPOSIT",
        status: "PARTIALLY_PAID",
        paidAt: new Date(),
        // The Payment row alone is not enough. Code that asks "is there
        // anything here to refund?" — refundableRecordedAmount, and the
        // ledger assertions generally — sums DEPOSIT/FINAL_PAYMENT
        // transactions rather than trusting paidAmount, precisely because a
        // paidAmount with nothing behind it is the bug it guards against.
        // Seeding without this produces an appointment that looks paid and
        // behaves as though nothing was ever collected.
        transactions: {
          create: {
            amount: deposit,
            method: "ONLINE",
            transactionType: "DEPOSIT",
            paidAt: new Date(),
          },
        },
      },
    });
  } else if (payment === "paid") {
    paymentRow = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        totalAmount: price,
        paidAmount: price,
        remainingAmount: 0,
        depositAmount: 0,
        paymentType: "ONLINE",
        status: "PAID",
        paidAt: new Date(),
        transactions: {
          create: {
            amount: price,
            method: "ONLINE",
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
          },
        },
      },
    });
  }

  return { service, staffService, appointment, payment: paymentRow };
}

/**
 * A completed, paid booking on an existing formation session — seeded
 * directly, the same way seedAppointment's `payment: "paid"` branch skips
 * Stripe: this suite proves attribution and display, not the checkout flow.
 */
export async function seedFormationReservation({ session, customer, price = 200 }) {
  const reservation = await prisma.formationReservation.create({
    data: {
      sessionId: session.id,
      customerId: customer.id,
      seatsCount: 1,
      status: "COMPLETED",
      totalPrice: price,
      depositAmount: 0,
      balanceDue: 0,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      formationReservationId: reservation.id,
      totalAmount: price,
      paidAmount: price,
      remainingAmount: 0,
      depositAmount: 0,
      paymentType: "ONLINE",
      status: "PAID",
      paidAt: new Date(),
    },
  });

  return { reservation, payment };
}

/**
 * A past atelier/formation session "owned" by a given staff member
 * (`createdById`) — required for that staff member to even see or settle a
 * reservation on it (see `activityReservationStaffScope` in
 * lib/activity-reservation-access.js, which scopes STAFF to sessions they
 * created or animate). Past `startDate` so `settleReservation`'s "this
 * session hasn't happened yet" guard doesn't refuse the close.
 *
 * @param {{ kind: "WORKSHOP"|"FORMATION", createdById: string, price?: number, capacity?: number, hoursAgo?: number }} params
 */
export async function seedActivitySessionOwnedBy({ kind, createdById, price = 80, capacity = 8, hoursAgo = 2 }) {
  const runId = getRunId();
  const startDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  if (kind === "WORKSHOP") {
    const activity = await prisma.activity.create({
      data: {
        type: "WORKSHOP",
        title: `E2E Atelier ${runId}`,
        description: "Atelier créé automatiquement par la suite dashboard e2e.",
        price,
        duration: 120,
        capacity,
        status: "PUBLISHED",
        depositPercentage: 50,
        createdById,
      },
    });
    const session = await prisma.workshopSession.create({
      data: { workshopId: activity.id, startDate, capacity, status: "SCHEDULED" },
    });
    return { activity, session };
  }

  const formation = await prisma.formation.create({
    data: {
      type: "PUBLIC",
      title: `E2E Formation ${runId}`,
      description: "Formation créée automatiquement par la suite dashboard e2e.",
      price,
      duration: 240,
      capacity,
      status: "PUBLISHED",
      depositPercentage: 50,
      createdById,
    },
  });
  const session = await prisma.formationSession.create({
    data: { formationId: formation.id, startDate, capacity, status: "SCHEDULED" },
  });
  return { formation, session };
}

/**
 * A CONFIRMED, PARTIALLY_PAID booking on an existing workshop/formation
 * session — same shape as seedAppointment's `payment: "balanceDue"` branch:
 * a 50% deposit already paid online (with its own DEPOSIT Transaction), a
 * balance still due at the counter. `seedFormationReservation` above seeds an
 * already-COMPLETED/fully-PAID booking, the wrong shape for a spec that needs
 * to actually exercise "Clôturer" collecting a real balance.
 *
 * @param {{ kind: "WORKSHOP"|"FORMATION", session: object, customer: object, price?: number, seatsCount?: number }} params
 */
export async function seedActivityReservationWithBalance({ kind, session, customer, price = 80, seatsCount = 1 }) {
  const deposit = Number((price / 2).toFixed(2));
  const remaining = Number((price - deposit).toFixed(2));
  const delegate = kind === "WORKSHOP" ? prisma.workshopReservation : prisma.formationReservation;
  const foreignKey = kind === "WORKSHOP" ? "sessionId" : "sessionId";
  const paymentForeignKey = kind === "WORKSHOP" ? "workshopReservationId" : "formationReservationId";

  const reservation = await delegate.create({
    data: {
      [foreignKey]: session.id,
      customerId: customer.id,
      seatsCount,
      status: "CONFIRMED",
      totalPrice: price,
      depositAmount: deposit,
      balanceDue: remaining,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      [paymentForeignKey]: reservation.id,
      totalAmount: price,
      paidAmount: deposit,
      remainingAmount: remaining,
      depositAmount: deposit,
      paymentType: "DEPOSIT",
      status: "PARTIALLY_PAID",
      paidAt: new Date(),
      transactions: {
        create: {
          amount: deposit,
          method: "ONLINE",
          transactionType: "DEPOSIT",
          paidAt: new Date(),
        },
      },
    },
  });

  return { reservation, payment };
}

export async function seedAppointmentInvoice({ staff, customer, createdByUserId }) {
  const runId = getRunId();

  const { service, staffService, appointment, payment } = await seedAppointment({
    staff,
    customer,
    createdByUserId,
    hoursFromNow: 24 * 30,
    status: "CONFIRMED",
    payment: "paid",
  });

  const invoice = await prisma.invoice.create({
    data: {
      number: `E2E-${runId}-RDV`,
      source: "APPOINTMENT",
      paymentId: payment.id,
      sellerName: "Meri Beauty (e2e)",
      customerName: customer.fullName,
      customerEmail: customer.email,
      subtotalExclVat: 49.59,
      vatRate: 21,
      vatAmount: 10.41,
      totalInclVat: 60,
      lines: {
        create: [
          {
            description: `${service.name} (e2e)`,
            quantity: 1,
            unitPrice: 60,
            lineTotal: 60,
            unitPriceExclVat: 49.5868,
            lineTotalExclVat: 49.59,
          },
        ],
      },
    },
  });

  return { staffService, appointment, payment, invoice };
}

/**
 * An existing order-backed invoice, read only.
 *
 * Picked from real data rather than seeded because the ORDERS branch needs no
 * ownership relationship to be interesting — any order invoice proves the
 * point — and reading one costs nothing, while seeding an Order means
 * inventing stock, variants and a cash session.
 */
export async function findOrderInvoice() {
  const invoice = await prisma.invoice.findFirst({
    where: { payment: { order: { isNot: null } } },
    select: { id: true, number: true, payment: { select: { order: { select: { userId: true } } } } },
    orderBy: { issuedAt: "desc" },
  });
  if (!invoice) throw new Error("findOrderInvoice: no order-backed invoice in the database.");
  return invoice;
}

/**
 * A product with real stock, tagged with the run id.
 *
 * Never an existing dev variant: these scenarios assert on exact
 * `reservedQuantity` arithmetic, and a colleague's order landing on the same
 * variant mid-run would turn a correct result into a failing one (or, worse,
 * an incorrect one into a passing one).
 */
export async function seedStockedVariant({ label, stockQuantity = 10, price = 24.5 }) {
  const runId = getRunId();
  const slug = `e2e-${label}-${runId}`.toLowerCase();

  const product = await prisma.product.create({
    data: {
      name: `E2E Produit ${label} ${runId}`,
      slug,
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

  return { product, variant: product.variants[0] };
}

/**
 * An order in whatever state the scenario needs, with its reservation already
 * standing.
 *
 * `reservedQuantity` is incremented here to match what createOrderFromCart
 * would have done, because the reservation is the thing under test: the whole
 * point of the expired-pickup worklist is that this number stays put until a
 * human decides. Seeding an order without it would make every "stock was not
 * released" assertion trivially true.
 */
export async function seedOrder({
  variant,
  customer,
  status,
  fulfilmentMode = "PICKUP_ON_SITE",
  quantity = 2,
  expiresAt = null,
  stockReleasedAt = null,
  // Only meaningful with status EXPIRED. releaseUnverifiedPickups measures
  // its grace period from this column, so a test about the backstop has to be
  // able to place an order in the past — nothing else can age one.
  cancelledAt = null,
  // "paid" attaches a settled Payment with one FINAL_PAYMENT transaction, the
  // shape fulfillOrderPayment leaves behind. Deliberately **no Invoice**:
  // an order only gets one when the buyer has a validated VAT number
  // (hasInvoiceableVatIdentity), so a particulier's paid order has none, and
  // that absence is exactly what the returns scenario is about.
  payment = "none",
  // The legal start of the 14-day withdrawal window (returns.js#withdrawalWindow
  // reads pickedUpAt ?? collectedAt). Without one there is no window at all,
  // and a returns test would be exercising a different branch than it thinks.
  pickedUpAt = null,
  // A PromoCode this order consumed. Its usedCount is incremented here the
  // way createOrderFromCart would have, because giving it back is the thing
  // under test — seeding a code still at 0 would make "it was released"
  // trivially true.
  promoCode = null,
}) {
  const unitPrice = Number(variant.price);
  const totalAmount = Number((unitPrice * quantity).toFixed(2));

  const order = await prisma.order.create({
    data: {
      userId: customer.id,
      fulfilmentMode,
      status,
      source: "ONLINE",
      subtotal: totalAmount,
      totalAmount,
      totalExclVat: Number((totalAmount / 1.21).toFixed(2)),
      totalVat: Number((totalAmount - totalAmount / 1.21).toFixed(2)),
      expiresAt,
      stockReleasedAt,
      pickedUpAt,
      ...(promoCode ? { promoCodeId: promoCode.id } : {}),
      ...(status === "EXPIRED"
        ? {
            cancelledAt: cancelledAt ?? new Date(),
            cancelReason: "Retrait non effectué dans le délai imparti",
          }
        : {}),
      items: {
        create: {
          variantId: variant.id,
          productName: `E2E Produit (${variant.sku})`,
          variantName: variant.name,
          sku: variant.sku,
          unitPrice,
          quantity,
        },
      },
    },
    include: { items: true },
  });

  await prisma.productVariant.update({
    where: { id: variant.id },
    data: { reservedQuantity: { increment: quantity } },
  });

  if (promoCode) {
    await prisma.promoCode.update({
      where: { id: promoCode.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  let paymentRow = null;
  if (payment === "paid") {
    paymentRow = await prisma.payment.create({
      data: {
        orderId: order.id,
        totalAmount,
        paidAmount: totalAmount,
        remainingAmount: 0,
        depositAmount: 0,
        paymentType: "ONLINE",
        status: "PAID",
        paidAt: new Date(),
        transactions: {
          create: {
            amount: totalAmount,
            method: "ONLINE",
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
          },
        },
      },
    });
  }

  return { ...order, payment: paymentRow };
}

/**
 * A promo code nobody else's run can consume.
 *
 * `usedCount` is the interesting column: it is claimed atomically at booking
 * (`createOrderFromCart`) and given back whenever the order it was claimed
 * for stops existing — an abandoned checkout, a staff "she never came"
 * verdict, a refund, and now the 14-day automatic release. Each of those
 * lives in a different module, and only one of them had a real test.
 *
 * A single-use code (`maxUses: 1`) is deliberate: it makes a leak visible as
 * a code that can never be used again, rather than as a number that is
 * merely one too high.
 *
 * @param {{ label: string, value?: number, maxUses?: number|null }} input
 */
export async function seedPromoCode({ label, value = 10, maxUses = 1 }) {
  const runId = getRunId();
  return prisma.promoCode.create({
    data: {
      code: `E2E-${label}-${runId}`.toUpperCase(),
      type: "PERCENTAGE",
      value,
      isActive: true,
      maxUses,
      usedCount: 0,
    },
  });
}

/** How many times a code is currently counted as used. */
export async function readPromoUsage(promoCodeId) {
  const promo = await prisma.promoCode.findUnique({
    where: { id: promoCodeId },
    select: { usedCount: true, maxUses: true },
  });
  return { used: promo.usedCount, maxUses: promo.maxUses };
}

/** The two numbers every stock assertion in this suite is about. */
export async function readStock(variantId) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stockQuantity: true, reservedQuantity: true },
  });
  return { stock: variant.stockQuantity, reserved: variant.reservedQuantity };
}

/** Deletes exactly what one run created, in foreign-key-safe order. */
export async function purgeDashboardRun(runId = getRunId()) {
  const users = await prisma.user.findMany({
    where: { email: { contains: runId } },
    select: { id: true, email: true },
  });
  const userIds = users.map((user) => user.id);
  const userEmails = users.map((user) => user.email);

  const deleted = {};
  // The seeded invoice carries no legal number, so unlike the money suite's
  // it can and should go.
  deleted.workingHours = (await prisma.workingHour.deleteMany({
    where: { staff: { userId: { in: userIds } } },
  })).count;
  deleted.contracts = (await prisma.contract.deleteMany({
    where: { staff: { userId: { in: userIds } } },
  })).count;
  deleted.invoiceLines = (await prisma.invoiceLine.deleteMany({
    where: { invoice: { number: { contains: runId } } },
  })).count;
  deleted.invoices = (await prisma.invoice.deleteMany({ where: { number: { contains: runId } } })).count;

  // Transactions before the payments that own them: Transaction_paymentId_fkey
  // is RESTRICT, so deleting a Payment that settled anything fails outright.
  // Both sources need this — an appointment whose balance was collected has
  // transactions exactly as an order does, and only the order half of that
  // was handled when this was first written.
  deleted.appointmentTransactions = (await prisma.transaction.deleteMany({
    where: { payment: { appointment: { userId: { in: userIds } } } },
  })).count;
  deleted.payments = (await prisma.payment.deleteMany({
    where: { appointment: { userId: { in: userIds } } },
  })).count;
  deleted.appointments = (await prisma.appointment.deleteMany({ where: { userId: { in: userIds } } })).count;
  deleted.staffServices = (await prisma.staffService.deleteMany({
    where: { staff: { user: { id: { in: userIds } } } },
  })).count;
  deleted.staff = (await prisma.staff.deleteMany({ where: { userId: { in: userIds } } })).count;

  // Boutique rows. Order before user, item before order, and the audit trail
  // and inventory movements before the variants they point at.
  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const variants = await prisma.productVariant.findMany({
    where: { product: { slug: { contains: runId } } },
    select: { id: true },
  });
  const variantIds = variants.map((variant) => variant.id);

  deleted.auditLogs = (await prisma.auditLog.deleteMany({
    where: { entityType: "Order", entityId: { in: orderIds } },
  })).count;
  deleted.inventoryMovements = (await prisma.inventoryMovement.deleteMany({
    where: { variantId: { in: variantIds } },
  })).count;
  deleted.transactions = (await prisma.transaction.deleteMany({
    where: { payment: { orderId: { in: orderIds } } },
  })).count;
  deleted.orderPayments = (await prisma.payment.deleteMany({
    where: { orderId: { in: orderIds } },
  })).count;
  deleted.orderItems = (await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })).count;
  deleted.orders = (await prisma.order.deleteMany({ where: { id: { in: orderIds } } })).count;
  deleted.variants = (await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } })).count;
  deleted.products = (await prisma.product.deleteMany({ where: { slug: { contains: runId } } })).count;

  // Formation rows. Transaction before Payment — Transaction_paymentId_fkey
  // is RESTRICT, exactly like the appointment case above, and a formation
  // reservation actually sold at the counter (rather than hand-seeded by
  // seedFormationReservation, which leaves no Transaction row at all) has
  // one. Missed until a real counter sale went through this purge for the
  // first time and it failed 23001 mid-delete. Payment before
  // FormationReservation (Payment.formationReservationId has no cascade),
  // FormationReservation before Formation (FormationSession keeps ON DELETE
  // RESTRICT against its reservations, so a still-booked session blocks the
  // Formation's own cascade into FormationSession). The Animator is the
  // auto-upserted profile resolveFormationAnimatorId() creates when a
  // formation is assigned to a tagged staff member in the UI — same email,
  // safe to drop once nothing references it. Scoped by title (not
  // customerId alone) so a formation left with no reservation is still
  // cleaned up.
  deleted.formationTransactions = (await prisma.transaction.deleteMany({
    where: { payment: { formationReservation: { customerId: { in: userIds } } } },
  })).count;
  deleted.formationPayments = (await prisma.payment.deleteMany({
    where: { formationReservation: { customerId: { in: userIds } } },
  })).count;
  deleted.formationReservations = (await prisma.formationReservation.deleteMany({
    where: { customerId: { in: userIds } },
  })).count;
  deleted.formations = (await prisma.formation.deleteMany({
    where: { title: { contains: runId } },
  })).count;
  deleted.animators = (await prisma.animator.deleteMany({
    where: { email: { in: userEmails } },
  })).count;

  deleted.users = (await prisma.user.deleteMany({ where: { id: { in: userIds } } })).count;

  return { runId, deleted };
}
