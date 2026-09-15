import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

/**
 * "Générer note de crédit" is not a new orchestrator — it is the exact same
 * cancelAndRefund/previewCancelAndRefund actions "Annuler et rembourser"
 * already uses, with one new trigger (POST_COMPLETION_CORRECTION) that
 * lib/refunds/authorize.js lets through the COMPLETED/shipped guards.
 *
 * This test exists specifically because of a bug caught while wiring it up:
 * authorize.js allowing the trigger through is not enough on its own —
 * lib/refunds/open-refund-operation.js#cancelUnderlyingItem's own
 * `updateMany` for APPOINTMENT/WORKSHOP/FORMATION only matches
 * PENDING/ACCEPTED/CONFIRMED-style statuses, never COMPLETED, so the actual
 * cancellation would have silently no-op'd for those three sources even
 * though authorize.js said yes. Real Postgres, real status transition —
 * exactly the kind of thing a source-content assertion would miss.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const adminSession = { user: { id: "will-be-set", role: "ADMIN", name: "Test Admin", email: "admin@example.test" } };
vi.mock("@/auth", () => ({ auth: vi.fn(async () => adminSession) }));

const { prisma } = await import("@/lib/prisma");
const { cancelAndRefund, previewCancelAndRefund } = await import("@/actions/dashboard/cancel-and-refund");

const tag = testTag();
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

describe("post-completion credit note (real database)", () => {
  let customer, admin, staffUser, staff, category, service, staffService;
  let appointment, appointmentPayment;
  let secondAppointment, secondPayment;
  let order, orderPayment;
  let activity, workshopSession, reservation, reservationPayment;
  let vatCustomer, optedOutOrder, optedOutPayment;
  let vatCustomer2, mistakeOrder, mistakePayment;

  beforeAll(async () => {
    // Default hookTimeout (10s) is too tight now that setup creates seven
    // users and five payments in sequence against the real dev Neon DB.
    customer = await prisma.user.create({
      data: { fullName: `${tag}-customer`, email: `${tag}-customer@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
    admin = await prisma.user.create({
      data: { fullName: `${tag}-admin`, email: `${tag}-admin@example.test`, phone: uniquePhone(), password: "x", role: "ADMIN", emailVerified: true },
    });
    adminSession.user.id = admin.id;

    staffUser = await prisma.user.create({
      data: { fullName: `${tag}-staff`, email: `${tag}-staff@example.test`, phone: uniquePhone(), password: "x", role: "STAFF", emailVerified: true },
    });
    staff = await prisma.staff.create({ data: { userId: staffUser.id, type: "EMPLOYEE", yearsOfExperience: 1 } });
    category = await prisma.category.create({ data: { name: `${tag}-category` } });
    service = await prisma.service.create({ data: { name: `${tag}-service`, categoryId: category.id } });
    staffService = await prisma.staffService.create({
      data: { staffId: staff.id, serviceId: service.id, createdById: staffUser.id, price: 45, duration: 30, photo: "" },
    });

    const apptBase = { userId: customer.id, staffServiceId: staffService.id, staffId: staff.id };
    appointment = await prisma.appointment.create({
      data: { ...apptBase, date: new Date("2026-08-01"), startTime: new Date("2026-08-01T10:00:00Z"), endTime: new Date("2026-08-01T10:30:00Z"), status: "COMPLETED" },
    });
    appointmentPayment = await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        depositAmount: 0,
        totalAmount: 45,
        paidAmount: 45,
        remainingAmount: 0,
        paymentType: "ON_SITE",
        status: "PAID",
        paidAt: new Date(),
        transactions: { create: [{ amount: 45, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });

    // A second, otherwise-identical COMPLETED appointment to prove every
    // OTHER trigger still gets denied — the exception must stay narrow.
    secondAppointment = await prisma.appointment.create({
      data: { ...apptBase, date: new Date("2026-08-02"), startTime: new Date("2026-08-02T10:00:00Z"), endTime: new Date("2026-08-02T10:30:00Z"), status: "COMPLETED" },
    });
    secondPayment = await prisma.payment.create({
      data: {
        appointmentId: secondAppointment.id,
        depositAmount: 0,
        totalAmount: 45,
        paidAmount: 45,
        remainingAmount: 0,
        paymentType: "ON_SITE",
        status: "PAID",
        paidAt: new Date(),
        transactions: { create: [{ amount: 45, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });

    order = await prisma.order.create({
      data: {
        userId: customer.id,
        fulfilmentMode: "PICKUP_ON_SITE",
        status: "COMPLETED",
        source: "ONLINE",
        subtotal: 30,
        totalAmount: 30,
        vatRate: 21,
        items: { create: [{ productName: `${tag}-product`, unitPrice: 30, quantity: 1 }] },
      },
    });
    orderPayment = await prisma.payment.create({
      data: {
        orderId: order.id,
        depositAmount: 0,
        totalAmount: 30,
        paidAmount: 30,
        remainingAmount: 0,
        paymentType: "ON_SITE",
        status: "PAID",
        paidAt: new Date(),
        transactions: { create: [{ amount: 30, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });

    // A COMPLETED atelier reservation. This is the source the other two
    // cases do NOT cover: WORKSHOP/FORMATION go through
    // cancelUnderlyingItem's `reservationStatuses` branch, a different
    // status set from the appointment one, and reservations are also the
    // only thing an admin can transfer between sessions — so "a finished
    // booking can be cancelled" has to be proven here, not inferred.
    activity = await prisma.activity.create({
      data: { type: "WORKSHOP", title: `${tag}-atelier`, price: 60, duration: 90, capacity: 8, status: "PUBLISHED" },
    });
    workshopSession = await prisma.workshopSession.create({
      data: { workshopId: activity.id, startDate: new Date("2026-08-05T10:00:00Z"), capacity: 8 },
    });
    reservation = await prisma.workshopReservation.create({
      data: { sessionId: workshopSession.id, customerId: customer.id, seatsCount: 1, status: "COMPLETED", totalPrice: 60 },
    });
    reservationPayment = await prisma.payment.create({
      data: {
        workshopReservationId: reservation.id,
        depositAmount: 0,
        totalAmount: 60,
        paidAmount: 60,
        remainingAmount: 0,
        paymentType: "ON_SITE",
        status: "PAID",
        paidAt: new Date(),
        transactions: { create: [{ amount: 60, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });

    // A VAT-eligible (isCompany + valid, recently-checked VAT) customer who
    // explicitly declined the invoice at the till — Order.invoiceRequested:
    // false. No Invoice row exists for this sale by the customer's own
    // choice, not by mistake. Proves that no longer gets blocked as if it
    // were an inconsistency to fix first.
    vatCustomer = await prisma.user.create({
      data: {
        fullName: `${tag}-vat-optout`, email: `${tag}-vat-optout@example.test`, phone: uniquePhone(),
        password: "x", role: "CUSTOMER", emailVerified: true,
        isCompany: true, vatNumber: "BE0123456749", vatValidatedAt: new Date(),
      },
    });
    optedOutOrder = await prisma.order.create({
      data: {
        userId: vatCustomer.id, fulfilmentMode: "PICKUP_ON_SITE", status: "COMPLETED",
        subtotal: 40, totalAmount: 40, vatRate: 21, invoiceRequested: false,
        items: { create: [{ productName: `${tag}-product-optout`, unitPrice: 40, quantity: 1 }] },
      },
    });
    optedOutPayment = await prisma.payment.create({
      data: {
        orderId: optedOutOrder.id, depositAmount: 0, totalAmount: 40, paidAmount: 40, remainingAmount: 0,
        paymentType: "ON_SITE", status: "PAID", paidAt: new Date(),
        transactions: { create: [{ amount: 40, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });

    // Same VAT-eligible profile, but no invoice AND no opt-out on record
    // (invoiceRequested left at its default) — a genuine inconsistency, not
    // a choice. Must still be blocked, or the exception above stops being
    // narrow.
    // Same VAT number as vatCustomer above (deliberately): the checksum has
    // to actually pass hasReusableVatValidation's isValidVatFormat check, and
    // this is the one already proven valid throughout the existing fixtures
    // — a second, invented number silently fails that check instead of
    // exercising the B2B path this test means to prove is still blocked.
    vatCustomer2 = await prisma.user.create({
      data: {
        fullName: `${tag}-vat-mistake`, email: `${tag}-vat-mistake@example.test`, phone: uniquePhone(),
        password: "x", role: "CUSTOMER", emailVerified: true,
        isCompany: true, vatNumber: "BE0123456749", vatValidatedAt: new Date(),
      },
    });
    mistakeOrder = await prisma.order.create({
      data: {
        userId: vatCustomer2.id, fulfilmentMode: "PICKUP_ON_SITE", status: "COMPLETED",
        subtotal: 40, totalAmount: 40, vatRate: 21,
        items: { create: [{ productName: `${tag}-product-mistake`, unitPrice: 40, quantity: 1 }] },
      },
    });
    mistakePayment = await prisma.payment.create({
      data: {
        orderId: mistakeOrder.id, depositAmount: 0, totalAmount: 40, paidAmount: 40, remainingAmount: 0,
        paymentType: "ON_SITE", status: "PAID", paidAt: new Date(),
        transactions: { create: [{ amount: 40, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date() }] },
      },
    });
  }, 30000);

  afterAll(async () => {
    const paymentIds = [
      appointmentPayment?.id, secondPayment?.id, orderPayment?.id, reservationPayment?.id,
      optedOutPayment?.id, mistakePayment?.id,
    ].filter(Boolean);
    await prisma.refundLeg.deleteMany({ where: { refundOperation: { paymentId: { in: paymentIds } } } });
    await prisma.refundOperation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.transaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: [order?.id, optedOutOrder?.id, mistakeOrder?.id].filter(Boolean) } } });
    await prisma.order.deleteMany({ where: { id: { in: [order?.id, optedOutOrder?.id, mistakeOrder?.id].filter(Boolean) } } });
    await prisma.appointment.deleteMany({ where: { id: { in: [appointment?.id, secondAppointment?.id].filter(Boolean) } } });
    if (reservation) await prisma.workshopReservation.delete({ where: { id: reservation.id } });
    if (workshopSession) await prisma.workshopSession.delete({ where: { id: workshopSession.id } });
    if (activity) await prisma.activity.delete({ where: { id: activity.id } });
    if (staffService) await prisma.staffService.delete({ where: { id: staffService.id } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
    if (category) await prisma.category.delete({ where: { id: category.id } });
    if (staff) await prisma.staff.delete({ where: { id: staff.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [customer?.id, admin?.id, staffUser?.id, vatCustomer?.id, vatCustomer2?.id].filter(Boolean) } },
    });
  });

  test("POST_COMPLETION_CORRECTION actually cancels a COMPLETED appointment — not just authorized, really written", async () => {
    const preview = await previewCancelAndRefund({
      paymentId: appointmentPayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Prix erroné constaté après coup",
    });
    expect(preview.success).toBe(true);
    expect(preview.data.allowed).toBe(true);
    expect(preview.data.currentStatus).toBe("COMPLETED");

    const result = await cancelAndRefund({
      paymentId: appointmentPayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Prix erroné constaté après coup",
    });
    expect(result.success).toBe(true);

    const reloaded = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.cancelledAt).not.toBeNull();

    const operation = await prisma.refundOperation.findFirstOrThrow({
      where: { paymentId: appointmentPayment.id },
      include: { legs: true },
    });
    expect(operation.trigger).toBe("POST_COMPLETION_CORRECTION");
    expect(Number(operation.totalAmount)).toBeCloseTo(45, 2);
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("CASH");
  });

  test("every OTHER trigger still refuses a COMPLETED appointment — the exception stays narrow", async () => {
    const result = await cancelAndRefund({
      paymentId: secondPayment.id,
      trigger: "SALON_CANCELLATION",
      reason: "Tentative de contournement via le mauvais trigger",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("COMPLETED_NOT_REFUNDABLE");

    const reloaded = await prisma.appointment.findUniqueOrThrow({ where: { id: secondAppointment.id } });
    expect(reloaded.status).toBe("COMPLETED"); // untouched
  });

  test("POST_COMPLETION_CORRECTION also cancels a COMPLETED order (already-permissive status set, confirmed end to end)", async () => {
    const result = await cancelAndRefund({
      paymentId: orderPayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Produit facturé au mauvais prix",
    });
    expect(result.success).toBe(true);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("CANCELLED");

    const operation = await prisma.refundOperation.findFirstOrThrow({ where: { paymentId: orderPayment.id }, include: { legs: true } });
    expect(operation.trigger).toBe("POST_COMPLETION_CORRECTION");
    expect(Number(operation.totalAmount)).toBeCloseTo(30, 2);
  });

  test("a COMPLETED atelier reservation is cancelled outright — never turned into anything else", async () => {
    const result = await cancelAndRefund({
      paymentId: reservationPayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Séance facturée au mauvais tarif",
    });
    expect(result.success).toBe(true);

    const reloaded = await prisma.workshopReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.cancelledAt).not.toBeNull();
    // The seat goes back on sale; the booking does not quietly survive as a
    // live reservation on some other session.
    expect(reloaded.sessionId).toBe(workshopSession.id);

    // A cancellation is not a transfer: the two are separate features that
    // share nothing. Only changeReservationSession writes this audit action,
    // so a cancelled booking must leave no transfer trace behind it.
    const transfers = await prisma.auditLog.count({
      where: { action: "reservation.session_transferred", entityId: reservation.id },
    });
    expect(transfers).toBe(0);

    const operation = await prisma.refundOperation.findFirstOrThrow({ where: { paymentId: reservationPayment.id } });
    expect(operation.trigger).toBe("POST_COMPLETION_CORRECTION");
    expect(operation.source).toBe("WORKSHOP");
    expect(Number(operation.totalAmount)).toBeCloseTo(60, 2);
  });

  test("a VAT-eligible customer who explicitly declined the invoice can still be cancelled — no document to fix first", async () => {
    const result = await cancelAndRefund({
      paymentId: optedOutPayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Article facturé au mauvais prix, client sans facture par choix",
    });
    expect(result.success).toBe(true);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: optedOutOrder.id } });
    expect(reloaded.status).toBe("CANCELLED");

    const operation = await prisma.refundOperation.findFirstOrThrow({ where: { paymentId: optedOutPayment.id } });
    expect(operation.trigger).toBe("POST_COMPLETION_CORRECTION");
    // No invoice existed and none was manufactured for the occasion — the
    // customer's own choice at the till is honoured, not overridden.
    expect(operation.creditNoteId).toBeNull();
  });

  test("the same VAT-eligible profile with NO recorded opt-out is still blocked — the exception stays narrow", async () => {
    const result = await cancelAndRefund({
      paymentId: mistakePayment.id,
      trigger: "POST_COMPLETION_CORRECTION",
      reason: "Tentative sur un B2B sans facture ni opt-out",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("B2B_INVOICE_REQUIRED");

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: mistakeOrder.id } });
    expect(reloaded.status).toBe("COMPLETED"); // untouched — nothing was cancelled
  });
});
