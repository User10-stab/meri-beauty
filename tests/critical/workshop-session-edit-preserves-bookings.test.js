import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 31 Aug 2026 production incident: three real customer bookings on YULE and
// HALLOWEEN COCOON NIGHT vanished with no trace. Root cause, confirmed
// against the production DB — every workshop_sessions row had a createdAt
// identical to its workshop's updatedAt, i.e. every session had been deleted
// and re-created by an ordinary edit.
//
// The single-session branch of the modal payload omitted the existing
// session's id, so updateActivity's diff read that session as "removed" and
// hard-deleted it. workshop_reservations.sessionId is ON DELETE CASCADE, so
// the bookings went with it silently, and Payment.workshopReservationId
// (ON DELETE SET NULL) was left dangling, breaking any later refund.
//
// The formations module already carried both halves of this fix (see
// manual-appointment-and-formation-sessions-contracts.test.js); workshops had
// neither. These tests keep both modules at parity.
describe("editing a workshop never silently destroys its reservations", () => {
  const actions = source("actions/workshops/create-activity.js");
  const modal = source("components/dashboard/workshops/CreateActivityModal.jsx");

  test("the single-session payload carries the existing session id", () => {
    // Without this the server sees no incoming id at all and treats the live
    // session as removed — the exact shape that caused the incident.
    expect(modal).toContain("...(activity?.sessions?.[0]?.id ? { id: activity.sessions[0].id } : {})");
  });

  test("the server refuses to delete a session that already has reservations", () => {
    expect(actions).toContain("reservations: { some: {} }");
    expect(actions).toContain("_count: { select: { reservations: true } }");
    expect(actions).toContain("bookedSessions.length > 0");
  });

  test("the booking guard runs before the delete, not after", () => {
    const guardIdx = actions.indexOf("bookedSessions.length > 0");
    const deleteIdx = actions.indexOf("prisma.workshopSession.deleteMany");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(guardIdx);
  });

  test("the guard returns a message instead of throwing a raw DB error", () => {
    const guardIdx = actions.indexOf("bookedSessions.length > 0");
    const block = actions.slice(guardIdx, guardIdx + 800);
    expect(block).toContain("success: false");
    expect(block).toContain("réservation");
  });
});

// The same omission existed in the formations modal. Its server guard meant
// it failed loudly rather than losing data, but editing a booked
// single-session formation was simply impossible until the id was carried.
describe("editing a booked single-session formation stays possible", () => {
  const modal = source("components/dashboard/formations/CreateFormationModal.jsx");

  test("the single-session payload carries the existing session id", () => {
    expect(modal).toContain("...(formation?.sessions?.[0]?.id ? { id: formation.sessions[0].id } : {})");
  });
});

// 2 Sep 2026: a second, narrower case of the exact same bug class, found on
// production formation "Test Marwane" — allowMultipleSessions: false, but 2
// FormationSession rows (2 bookings), left over from a time the toggle was
// on. Carrying only formation.sessions[0]'s id (the fix above) still dropped
// every OTHER existing session from the payload whenever the form was in
// single-session mode — updateFormation read those as "removed", and its
// booked-session guard then refused the ENTIRE save. From the dashboard this
// looked like "I can't even archive this formation", for a reason completely
// unrelated to what the admin was trying to change.
describe("editing a single-session-mode formation that still carries extra historical sessions", () => {
  const modal = source("components/dashboard/formations/CreateFormationModal.jsx");

  test("sessions beyond the first are still loaded into state regardless of the toggle", () => {
    expect(modal).toContain("if (formation.sessions?.length > 0) {");
  });

  test("the single-session submit branch appends every other existing session, untouched, instead of dropping them", () => {
    const branchIdx = modal.indexOf("Single-session mode only ever edits the first session");
    expect(branchIdx).toBeGreaterThan(-1);
    const branch = modal.slice(branchIdx, branchIdx + 2200);
    expect(branch).toContain("...sessions.slice(1).map((s) => ({");
    expect(branch).toContain("id: s.id,");
  });
});

// Deleting the parent is the other route to the same cascade: Activity ->
// sessions -> reservations. Both delete actions were unguarded, so removing
// an activity destroyed its bookings just as silently as editing one did.
describe("deleting an activity or formation never destroys its bookings", () => {
  test("deleteActivity counts reservations through the session and refuses", () => {
    const actions = source("actions/workshops/create-activity.js");
    const fnIdx = actions.indexOf("export async function deleteActivity");
    const fn = actions.slice(fnIdx);
    expect(fn).toContain("prisma.workshopReservation.count");
    expect(fn).toContain("session: { workshopId: id }");
    // The refusal must come before the delete, and name archiving as the way out.
    const guardIdx = fn.indexOf("reservationCount > 0");
    const deleteIdx = fn.indexOf("prisma.activity.delete");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(guardIdx);
    expect(fn).toContain("Archivé");
  });

  test("deleteFormation applies the same guard", () => {
    const actions = source("actions/formations/create-formation.js");
    const fnIdx = actions.indexOf("export async function deleteFormation");
    const fn = actions.slice(fnIdx);
    expect(fn).toContain("prisma.formationReservation.count");
    expect(fn).toContain("session: { formationId: id }");
    const guardIdx = fn.indexOf("reservationCount > 0");
    const deleteIdx = fn.indexOf("prisma.formation.delete");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(guardIdx);
    expect(fn).toContain("Archivé");
  });
});

// The application guards above are the readable error; this constraint is the
// backstop for any future code path that forgets to check first.
describe("the database itself refuses to drop a booked session", () => {
  const schema = source("prisma/schema.prisma");

  test("both reservation->session relations are Restrict, not Cascade", () => {
    for (const relation of [
      "session           WorkshopSession           @relation(fields: [sessionId], references: [id], onDelete: Restrict)",
      "session           FormationSession           @relation(fields: [sessionId], references: [id], onDelete: Restrict)",
    ]) {
      expect(schema).toContain(relation);
    }
  });

  test("a migration actually switches the live constraints", () => {
    const migration = source(
      "prisma/migrations/20260831130000_restrict_session_delete_with_reservations/migration.sql"
    );
    for (const table of ["workshop_reservations", "formation_reservations"]) {
      expect(migration).toContain(`ALTER TABLE "${table}"`);
    }
    // Both constraints re-added as RESTRICT. Checked on the executable
    // statements only — the header comment quotes "ON DELETE CASCADE" when
    // describing the behaviour this migration removes.
    const statements = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.split("ON DELETE RESTRICT").length - 1).toBe(2);
    expect(statements).not.toContain("ON DELETE CASCADE");
  });
});
