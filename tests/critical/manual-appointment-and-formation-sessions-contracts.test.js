import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 18 Aug 2026: editing a formation to add multiple sessions could crash with
// a raw Postgres CHECK-constraint violation (Payment_exactly_one_source) —
// reproduced directly against the dev DB. Root cause: the session-diff logic
// deletes any existing FormationSession the submitted form doesn't list,
// cascading into deleting real FormationReservation rows; if one had a
// Payment, ON DELETE SET NULL on Payment.formationReservationId left the
// Payment with no polymorphic source at all. Fixed two ways: the modal now
// always loads existing sessions (so toggling multi-session mode can't
// silently drop one), and the server now refuses to delete a session that
// already has bookings instead of letting Postgres crash.
describe("editing a formation with multiple sessions never crashes on existing bookings", () => {
  const actions = source("actions/formations/create-formation.js");
  const modal = source("components/dashboard/formations/CreateFormationModal.jsx");

  test("the client always loads existing sessions, not only when allowMultipleSessions was already on", () => {
    // The old, buggy condition gated loading on the *current* toggle state;
    // a single-session formation (allowMultipleSessions: false) would then
    // seed an empty sessions list, and flipping the toggle on mid-edit
    // silently orphaned that session in the server's diff.
    expect(modal).not.toMatch(/if \(formation\.allowMultipleSessions && formation\.sessions\?\.length > 0\)/);
    expect(modal).toContain("if (formation.sessions?.length > 0) {");
  });

  test("the server refuses to delete a session that already has reservations", () => {
    expect(actions).toContain("_count: { select: { reservations: true } }");
    expect(actions).toContain("withBookings.length > 0");
    // Must run before any delete, not after.
    const guardIdx = actions.indexOf("withBookings.length > 0");
    const deleteIdx = actions.indexOf("tx.formationSession.deleteMany");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(guardIdx);
  });

  test("the delete + create + per-session updates run inside one transaction", () => {
    expect(actions).toMatch(/const updated = await prisma\.\$transaction\(async \(tx\) => \{/);
  });
});

// 18 Aug 2026: staff had no way to add a phone booking or walk-in directly
// onto the calendar — the only path to create an Appointment was the public
// /reservation flow. createManualAppointment fills that gap.
describe("staff can add a manual appointment to the calendar", () => {
  const action = source("actions/appointment/create-manual-appointment.js");

  test("a STAFF caller can only act on their own calendar, never another staff member's", () => {
    expect(action).toContain("async function resolveActingStaffId(session, requestedStaffId)");
    expect(action).toContain("if (requestedStaffId && requestedStaffId !== ownStaffId) return null;");
  });

  test("it reuses the race-safe customer resolver instead of duplicating it", () => {
    expect(action).toContain(
      'import { resolveOrCreateCustomer } from "@/actions/reservation/create-reservation"'
    );
  });

  test("it does not filter StaffService by a Service.isActive field that doesn't exist in the schema", () => {
    // Service has no isActive column (only StaffService does) — filtering on
    // it throws PrismaClientValidationError at request time, not build time.
    const schema = source("prisma/schema.prisma");
    const serviceModel = schema.slice(schema.indexOf("model Service "), schema.indexOf("model Staff "));
    expect(serviceModel).not.toContain("isActive");
    expect(action).not.toMatch(/service:\s*\{\s*isActive:\s*true\s*\}/);
  });

  test("it creates the appointment CONFIRMED with no Payment row — same shape as a CASH_ONLY booking", () => {
    const createIdx = action.indexOf("const appointment = await prisma.appointment.create");
    const block = action.slice(createIdx, createIdx + 400);
    expect(block).toContain('status: "CONFIRMED"');
    expect(action).not.toContain("prisma.payment.create");
  });

  test("the error classes live outside the \"use server\" file, since a class export there breaks the module", () => {
    // Next.js requires every export of a "use server" module to be an async
    // function; exporting a plain class silently drops ALL of that module's
    // exports at build time (reproduced directly — the whole file resolved
    // to "no exports at all").
    const errors = source("lib/reservation-errors.js");
    expect(errors.trimStart().startsWith('"use server"')).toBe(false);
    expect(errors).toContain("export class SessionExpiredError");
    expect(errors).toContain("export class PhoneAlreadyRegisteredError");
    expect(action).toContain('from "@/lib/reservation-errors"');

    const createReservation = source("actions/reservation/create-reservation.js");
    expect(createReservation).not.toMatch(/export class \w+ extends Error/);
  });
});
