import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Three findings from a 48h-pre-launch risk pass, cross-checked against
// docs/PRODUCTION_ISSUES.md's still-open 🔴 items.
describe("48h pre-launch risk fixes", () => {
  test("workshop seat-increase re-checks capacity under lock before applying", () => {
    const webhook = source("app/api/webhooks/stripe/route.js");
    expect(webhook).toContain("SELECT id FROM workshop_sessions WHERE id = ${reservation.sessionId} FOR UPDATE");
    expect(webhook).toContain("takenByOthers + seats > capacity");
    expect(webhook).toContain('reason: "capacity exceeded"');
  });

  test("completing an appointment balance requires explicit payment confirmation", () => {
    const actions = source("actions/appointment/manage-appointment.js");
    expect(actions).toContain("paymentConfirmed !== true");
    expect(actions).toContain("requiresPaymentConfirmation: true");

    const drawer = source("components/dashboard/calendar/AppointmentDrawer.jsx");
    expect(drawer).toContain("paymentConfirmed");
    expect(drawer).toContain("disabled={isPending || !paymentConfirmed}");

    const list = source("components/dashboard/appointments/AppointmentsPageClient.jsx");
    expect(list).toContain("paymentConfirmed");
    expect(list).toContain("disabled={isPending || !paymentConfirmed}");
  });

  test("an expired on-site-pickup order alerts staff, not just the customer", () => {
    const expiry = source("lib/orders/expire-stale-orders.js");
    expect(expiry).toContain("async function alertStaffOfPickupExpiry");
    expect(expiry).toContain('order.status !== "PENDING_PAYMENT"');
  });

  test("the public CGV page no longer shows the internal draft note or a placeholder legal name", () => {
    const cgv = source("app/(public)/cgv/page.jsx");
    expect(cgv).not.toContain("à faire valider avant publication");
    expect(cgv).not.toContain("à compléter");
    expect(cgv).toContain("Marie Mercier");
  });
});
