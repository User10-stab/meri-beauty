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
    // The confirm button now also waits on the terminal receipt reference when
    // the method is a card, so the expression spans several lines. What has to
    // hold is that it still cannot be pressed without the attestation.
    expect(drawer).toMatch(/disabled=\{\s*isPending \|\|\s*!paymentConfirmed/);

    const list = source("components/dashboard/appointments/AppointmentsPageClient.jsx");
    expect(list).toContain("paymentConfirmed");
    expect(list).toMatch(/disabled={s*isPending ||s*!paymentConfirmed/);
  });

  test("an expired on-site-pickup order alerts staff, not just the customer", () => {
    const expiry = source("lib/orders/expire-stale-orders.js");
    expect(expiry).toContain("async function alertStaffOfPickupExpiry");
    // The branch that alerts staff is now the else of the never-paid branch:
    // a pickup tells the salon (and only the salon), because whether the goods
    // are on a shelf or in the customer's bag decides both what happens to the
    // stock and what the customer should be told.
    expect(expiry).toContain('if (order.status === "PENDING_PAYMENT") {');
    expect(expiry).toContain("alertStaffOfPickupExpiry(order)");
  });

  test("the public CGV page no longer shows the internal draft note or a placeholder legal name", () => {
    const cgv = source("app/(public)/cgv/page.jsx");
    expect(cgv).not.toContain("à faire valider avant publication");
    expect(cgv).not.toContain("à compléter");
    expect(cgv).toContain("Marie Mercier");
  });
});
