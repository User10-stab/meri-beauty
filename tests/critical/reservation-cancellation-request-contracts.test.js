import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Neither ateliers nor formations allow self-cancellation (the 50% deposit
// is non-refundable; exceptions are decided case by case). Until now the
// customer saw no cancel control and no explanation, so every such case
// became an untracked phone call. This mirrors the appointment flow's
// existing AppointmentCancellationRequest rather than granting self-service
// cancellation, which would contradict the confirmed policy.
describe("reservation cancellation requests never cancel or refund on their own", () => {
  const actions = source("actions/reservations/cancellation-request.js");

  test("submitting is customer-only and touches no Payment or Stripe", () => {
    const submitFn = actions.slice(
      actions.indexOf("export async function submitReservationCancellationRequest"),
      actions.indexOf("export async function getReservationCancellationRequests")
    );
    expect(submitFn).toContain('session.user.role !== "CUSTOMER"');
    expect(submitFn).not.toContain("stripe");
    expect(submitFn).not.toContain("refund");
    // Creates only the request row — never mutates the reservation itself.
    expect(submitFn).not.toContain('status: "CANCELLED"');
  });

  test("a customer can only request against their own reservation", () => {
    expect(actions).toContain("reservation.customerId !== session.user.id");
  });

  test("only an open reservation can be the subject of a request", () => {
    expect(actions).toContain('["PENDING_DEPOSIT", "CONFIRMED"].includes(reservation.status)');
  });

  test("reviewing is admin-only", () => {
    const guard = actions.slice(actions.indexOf("async function requireAdmin"), actions.indexOf("async function notifyAdmins"));
    expect(guard).toContain("isAdminRole(session.user.role)");
  });

  test("approval claims the request before cancelling, so two admins can't double-refund", () => {
    const claimIdx = actions.indexOf('data: { status: "APPROVED"');
    const cancelIdx = actions.indexOf("await config.cancel(");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeGreaterThan(claimIdx);
  });

  test("a failed cancellation returns the request to PENDING rather than leaving it falsely approved", () => {
    expect(actions).toContain('where: { id: request.id, status: "APPROVED" }');
    expect(actions).toContain("status: \"PENDING\", reviewedAt: null, reviewedByUserId: null, decisionNote: null");
  });

  test("approval delegates to the existing admin cancel actions instead of reimplementing refunds", () => {
    expect(actions).toContain("cancelWorkshopReservation(id, { reason, refundDeposit: true })");
    expect(actions).toContain("cancelFormationReservation(id, { reason, refundPayment: true })");
  });

  test("admin notifications skip deactivated and deleted accounts", () => {
    expect(actions).toContain('role: { in: ["OWNER", "ADMIN"] }, isActive: true, isDeleted: false');
  });
});

describe("schema backs the request with a real polymorphic table", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source(
    "prisma/migrations/20260812180000_add_reservation_cancellation_requests/migration.sql"
  );

  test("model exists with both optional sources, each unique", () => {
    expect(schema).toContain("model ReservationCancellationRequest");
    expect(schema).toMatch(/workshopReservationId\s+String\?\s+@unique/);
    expect(schema).toMatch(/formationReservationId\s+String\?\s+@unique/);
  });

  test("exactly-one-source is enforced in SQL, like Payment", () => {
    expect(migration).toContain("ReservationCancellationRequest_exactly_one_source");
    expect(migration).toContain('CASE WHEN "workshopReservationId" IS NOT NULL THEN 1 ELSE 0 END');
    expect(migration).toContain('CASE WHEN "formationReservationId" IS NOT NULL THEN 1 ELSE 0 END');
  });

  test("the notification type the action writes actually exists in the enum", () => {
    expect(schema).toContain("RESERVATION_CANCELLATION_REQUEST");
    expect(migration).toContain("ALTER TYPE \"NotificationType\" ADD VALUE IF NOT EXISTS 'RESERVATION_CANCELLATION_REQUEST'");
  });
});

describe("customer sees the policy and a route out instead of a dead end", () => {
  test("the reservation card explains the deposit rule and offers the request", () => {
    const client = source("components/website/MonComptePageClient.jsx");
    expect(client).toContain("submitReservationCancellationRequest");
    expect(client).toContain("Demander une annulation exceptionnelle");
    expect(client).toContain("l&apos;acompte reste acquis");
  });

  test("an existing request's state is loaded so the card can reflect it", () => {
    const history = source("actions/customer/order-history.js");
    const matches = history.match(/cancellationRequest: \{ select: \{ status: true, decisionNote: true \} \}/g);
    expect(matches).toHaveLength(2); // workshops + formations
  });

  test("the review queue is reachable from the dashboard sidebar, admin-only", () => {
    const nav = source("components/dashboard/Layouts/sidebar/data/index.js");
    expect(nav).toContain("/dashboard/reservations/exceptions");
    expect(nav).toContain("DASHBOARD_PERMISSIONS.APPOINTMENT_CANCELLATION_EXCEPTIONS");
  });
});
