import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkInQrDataUrl } from "@/lib/qrcode";
import {
  CHECK_IN_KINDS,
  generateCheckInCode,
  parseCheckInCode,
} from "@/lib/activities/check-in-code";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Normalized to LF — git runs with core.autocrlf=true and no .gitattributes,
// so a file rewritten by a checkout comes back CRLF in the working tree while
// the index stays LF, silently breaking multi-line \n matches.
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("a check-in code says which door it opens", () => {
  test("each kind mints a distinctly prefixed code that parses back to itself", () => {
    const atelier = generateCheckInCode(CHECK_IN_KINDS.WORKSHOP);
    const formation = generateCheckInCode(CHECK_IN_KINDS.FORMATION);
    const appointment = generateCheckInCode(CHECK_IN_KINDS.APPOINTMENT);

    expect(atelier).toMatch(/^A-[0-9A-F]{10}$/);
    expect(formation).toMatch(/^F-[0-9A-F]{10}$/);
    expect(appointment).toMatch(/^R-[0-9A-F]{10}$/);
    expect(parseCheckInCode(atelier)).toEqual({ kind: CHECK_IN_KINDS.WORKSHOP, code: atelier });
    expect(parseCheckInCode(formation)).toEqual({ kind: CHECK_IN_KINDS.FORMATION, code: formation });
    expect(parseCheckInCode(appointment)).toEqual({ kind: CHECK_IN_KINDS.APPOINTMENT, code: appointment });
  });

  test("two codes in a row are not the same", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCheckInCode(CHECK_IN_KINDS.WORKSHOP)));
    expect(codes.size).toBe(50);
  });

  test("it survives what a scanner and a human actually produce", () => {
    // A USB wedge appends a newline, a camera picks up whitespace, and a
    // human retyping the printed fallback drops the hyphen first.
    expect(parseCheckInCode("a-3f9c1b2d4e\n")).toEqual({ kind: "workshop", code: "A-3F9C1B2D4E" });
    expect(parseCheckInCode("  F-3F9C1B2D4E  ")).toEqual({ kind: "formation", code: "F-3F9C1B2D4E" });
    expect(parseCheckInCode("A3F9C1B2D4E")).toEqual({ kind: "workshop", code: "A-3F9C1B2D4E" });
  });

  test("a boutique pickup code is routed to the fourth counter domain", () => {
    expect(parseCheckInCode("AB12CD34")).toEqual({ kind: "pickup", code: "AB12CD34" });
    expect(parseCheckInCode("A3F9C1B2")).toEqual({ kind: "pickup", code: "A3F9C1B2" });
    expect(parseCheckInCode("")).toBeNull();
    expect(parseCheckInCode(null)).toBeNull();
    expect(parseCheckInCode("Z-3F9C1B2D4E")).toBeNull();
  });

  test("the QR is a scannable PNG data URL", async () => {
    const qr = await checkInQrDataUrl(generateCheckInCode(CHECK_IN_KINDS.FORMATION));
    expect(qr).toMatch(/^data:image\/png;base64,/);
  });
});

// The point of the ticket is that only a paid reservation has one. If a code
// leaked onto a cancelled or unpaid booking, the QR would look exactly as
// convincing as a real one to whoever is on the door.
describe("only a confirmed reservation carries a ticket", () => {
  const history = source("actions/customer/order-history.js");

  test("the profile nulls the code out for every status but CONFIRMED", () => {
    expect(history).toContain('const TICKETED_RESERVATION_STATUS = "CONFIRMED"');
    expect(history).toContain("if (reservation.status !== TICKETED_RESERVATION_STATUS)");
    expect(history).toContain("return { ...reservation, checkInCode: null, checkInQr: null }");
  });

  test("both reservation kinds get the same treatment", () => {
    expect(history).toContain("attachCheckInQr(r, CHECK_IN_KINDS.WORKSHOP)");
    expect(history).toContain("attachCheckInQr(r, CHECK_IN_KINDS.FORMATION)");
  });

  test("a QR failure degrades to no ticket instead of losing the whole history", () => {
    const block = history.slice(history.indexOf("async function attachCheckInQr"), history.indexOf("export async function getMyOrderHistory"));
    expect(block).toContain("catch (error)");
    expect(block).toContain("checkInQr: null");
  });
});

// Minting inside confirmWorkshopReservationPayment would put a unique-index
// collision on the same rollback path as a captured Stripe charge — the class
// of bug that made overlong notification text able to void a payment.
describe("minting a code can never roll back a payment", () => {
  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js"],
    ["lib/formations/fulfill-formation-reservation-payment.js"],
  ])("%s mints outside the payment transaction, on the committed client", (file) => {
    const content = source(file);
    // Everything inside prisma.$transaction writes through `tx`. Minting on
    // `prisma` is therefore structural proof it runs after the commit — a
    // unique-index collision on the generated code cannot take a captured
    // Stripe charge down with it.
    expect(content).toContain("ensureCheckInCode(prisma, CHECK_IN_KINDS.");
    expect(content).not.toContain("ensureCheckInCode(tx");
    expect(content).not.toContain("generateCheckInCode");
  });

  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js"],
    ["lib/formations/fulfill-formation-reservation-payment.js"],
  ])("%s mints only after the transaction block has closed", (file) => {
    const content = source(file);
    expect(content.indexOf("ensureCheckInCode(prisma")).toBeGreaterThan(
      content.lastIndexOf("await prisma.$transaction(")
    );
  });

  test("a failed mint still lets the confirmation e-mail go out", () => {
    const content = source("lib/workshops/fulfill-workshop-reservation-payment.js");
    const block = content.slice(content.indexOf("ensureCheckInCode(prisma"));
    expect(block).toContain("return null;");
    expect(content).toContain("const ticketQr = checkInCode");
  });

  test("the profile still mints lazily, for reservations confirmed before this shipped", () => {
    expect(source("actions/customer/order-history.js")).toContain("ensureCheckInCode(prisma, kind, reservation.id)");
  });

  test("the lazy mint is conditional, so two readers cannot mint two codes", () => {
    const helper = source("lib/activities/check-in-code.js");
    expect(helper).toContain('if (current.status !== "CONFIRMED") return null;');
    expect(helper).toContain('where: { id: reservationId, status: "CONFIRMED", checkInCode: null }');
    expect(helper).toContain("if (claim.count === 1) return code;");
    // A random collision must retry, not surface to the customer.
    expect(helper).toContain('if (error?.code !== "P2002") throw error;');
  });
});

describe("the scanner is gated, honest and race-safe", () => {
  const action = source("actions/activities/check-in.js");

  test("each kind of code demands its own permission", () => {
    expect(action).toContain("[CHECK_IN_KINDS.WORKSHOP]: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS");
    expect(action).toContain("[CHECK_IN_KINDS.FORMATION]: STAFF_PERMISSIONS.FORMATION_RESERVATIONS");
    expect(action).toContain("[CHECK_IN_KINDS.APPOINTMENT]: STAFF_PERMISSIONS.APPOINTMENTS");
    expect(action).toContain("hasDashboardPermission(session.user, PERMISSION_BY_KIND[parsed.kind])");
  });

  test("both entry points are gated, not just the write", () => {
    const lookup = action.slice(action.indexOf("export async function lookupActivityCheckIn"));
    const confirm = action.slice(action.indexOf("export async function confirmActivityCheckIn"));
    expect(lookup).toContain("await authorizeScan(rawCode)");
    expect(confirm).toContain("await authorizeScan(rawCode)");
  });

  test("the door sees the holder's name — a QR is a bearer token", () => {
    expect(action).toContain("holderName: reservation.customer.fullName");
  });

  test("the door sees the balance still owed, since activities sell on a 50% acompte", () => {
    expect(action).toContain("balanceDue: Number(reservation.balanceDue)");
    expect(source("components/dashboard/boutique/CounterPanel.jsx")).toContain(
      "Solde à encaisser"
    );
  });

  test("an unpaid, cancelled or exhausted ticket is refused", () => {
    expect(action).toContain('if (reservation.status === "PENDING_DEPOSIT")');
    expect(action).toContain('if (reservation.status === "CANCELLED")');
    expect(action).toContain("else if (remainingSeats <= 0)");
    expect(action).toContain("admissible: blockedReason === null");
  });

  test("the seat increment is row-locked, since Prisma cannot compare two columns", () => {
    expect(action).toContain("FOR UPDATE");
    const confirm = action.slice(action.indexOf("export async function confirmActivityCheckIn"));
    const lockIdx = confirm.indexOf("FOR UPDATE");
    const readIdx = confirm.indexOf("delegate.findUnique");
    const writeIdx = confirm.indexOf("delegate.update(");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(lockIdx);
    expect(writeIdx).toBeGreaterThan(readIdx);
  });

  test("a paid multi-seat ticket checks in every remaining reserved place", () => {
    const panel = source("components/dashboard/boutique/CounterPanel.jsx");
    const checkInAction = panel.slice(
      panel.indexOf("function CheckInAction"),
      panel.indexOf("function SettleAction")
    );

    expect(action).toContain("const seatsAdmitted = isAppointment ? 1 : before.remainingSeats");
    expect(action).toContain("checkedInSeats: { increment: seatsAdmitted }");
    expect(action).toContain("checkedInAt: reservation.checkedInAt ?? new Date()");
    expect(action).not.toContain("requestedSeats");
    expect(checkInAction).toContain("Places réservées");
    expect(checkInAction).toContain("confirmActivityCheckIn({ code: ticket.code })");
    expect(checkInAction).not.toContain("<select");
  });

  test("changing a workshop's reserved seat count remains in the separate 10% fee flow", () => {
    const management = source("actions/workshops/manage-reservation.js");
    expect(management).toContain("const SESSION_CHANGE_FEE_RATE = 0.1");
    expect(management).toContain(
      "const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE"
    );
    expect(management).toContain('workshopAction: "seats_change_fee"');
  });

  test("every admission is auditable", () => {
    expect(action).toContain("AUDIT_ACTIONS.RESERVATION_CHECKED_IN");
    expect(source("lib/audit-log.js")).toContain('RESERVATION_CHECKED_IN: "reservation.checked_in"');
  });
});

describe("the database backs up the application's seat guard", () => {
  const migration = source("prisma/migrations/20260824170000_add_activity_check_in/migration.sql");

  test.each([["workshop_reservations"], ["formation_reservations"]])(
    "%s cannot admit more people than were booked",
    (table) => {
      expect(migration).toContain(`ALTER TABLE "${table}"\n  ADD CONSTRAINT "${table}_checkedInSeats_within_booking"`);
      expect(migration).toContain(`CHECK ("checkedInSeats" >= 0 AND "checkedInSeats" <= "seatsCount")`);
    }
  );

  test.each([["workshop_reservations"], ["formation_reservations"]])("%s codes are unique", (table) => {
    expect(migration).toContain(`CREATE UNIQUE INDEX "${table}_checkInCode_key"`);
  });

  test("the migration does not backfill codes onto already-confirmed rows", () => {
    // A bulk INSERT of random values against a fresh unique index can collide
    // and fail the deploy; ensureCheckInCode fills those in on first read.
    expect(migration).not.toMatch(/UPDATE\s+"(workshop|formation)_reservations"\s+SET\s+"checkInCode"/i);
  });

  test("appointments have their own unique R-code and auditable check-in", () => {
    const appointmentMigration = source("prisma/migrations/20260827130000_add_appointment_check_in/migration.sql");
    expect(appointmentMigration).toContain('ADD COLUMN "checkInCode"');
    expect(appointmentMigration).toContain('CREATE UNIQUE INDEX "Appointment_checkInCode_key"');
    expect(appointmentMigration).toContain('FOREIGN KEY ("checkedInById") REFERENCES "User"("id")');
    expect(appointmentMigration).not.toMatch(/UPDATE\s+"Appointment"\s+SET\s+"checkInCode"/i);
  });
});

// The scanner started life on a page of its own under the sidebar. It reports
// "solde de X € à régler" and the money is taken at the counter, so keeping it
// anywhere but the till made staff read the amount on one screen and collect
// it on another.
describe("the entry scanner lives at the till", () => {
  const page = source("app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx");
  const panel = source("components/dashboard/boutique/CounterPanel.jsx");

  test("the till renders one unified pointage and settlement panel", () => {
    expect(page).toContain("<CounterPanel");
    expect(panel).toContain('import { lookupCounterCode } from "@/actions/counter/lookup"');
    expect(panel).toContain('import { searchCounterTickets } from "@/actions/boutique/settlements"');
  });

  test("scanning and settling include appointments, workshops and formations", () => {
    expect(page).toContain("canSettle={canAppointments || canWorkshops || canFormations}");
    expect(page).toContain("canCheckIn={canAppointments || canWorkshops || canFormations}");
  });

  test("a cashier holding no counter capability gets no panel at all", () => {
    expect(panel).toContain("if (!canCheckIn && !canSettle && !canPickup) return null;");
  });

  test("name search remains available for a customer without a phone or QR", () => {
    expect(panel).toContain("searchCounterTickets(value)");
    expect(panel).toContain("lookupActivityCheckInById({ kind: row.kind, id: row.id })");
    expect(panel).toContain("Code ou nom du client");
    expect(panel).toContain("[AFR]-?[0-9A-F]{10}");
  });

  test("name search resolves the matching customer before filtering each reservation type", () => {
    const settlements = source("actions/boutique/settlements.js");

    expect(settlements).toContain("async function findCustomerIdsByName(query)");
    expect(settlements).toContain("AND: terms.map((term) => ({");
    expect(settlements).toContain('fullName: { contains: term, mode: "insensitive" }');
    expect(settlements).toContain("const customerIds = await findCustomerIdsByName(value)");
    expect(settlements).toContain("userId: { in: customerIds }");
    expect(settlements).toContain("customerId: { in: customerIds }");
  });

  test("one unavailable reservation domain does not hide valid results from the others", () => {
    const settlements = source("actions/boutique/settlements.js");
    const search = settlements.slice(settlements.indexOf("export async function searchCounterTickets"));

    expect(search).toContain("Promise.allSettled([");
    expect(search).toContain('searchResults[0].status === "fulfilled"');
    expect(search).toContain('searchResults[1].status === "fulfilled"');
    expect(search).toContain('searchResults[2].status === "fulfilled"');
    expect(search).toContain("hasSuccessfulEnabledSearch");
  });

  test("the same scanner routes boutique pickup codes", () => {
    const lookup = source("actions/counter/lookup.js");
    const orders = source("actions/boutique/orders.js");
    expect(lookup).toContain("parsed?.kind === PICKUP_KIND");
    expect(lookup).toContain("lookupOrderByPickupCode(parsed.code)");
    expect(orders).toContain('["PAID", "READY_FOR_PICKUP", "PENDING_PICKUP"].includes(order.status)');
    expect(page).toContain("canPickup={canOrders}");
  });

  test("the standalone page and its bespoke sidebar gate are gone", () => {
    const nav = source("components/dashboard/Layouts/sidebar/data/index.js");
    expect(nav).not.toContain("/dashboard/pointage");
    // anyPermission existed only for that entry; leaving it would be dead
    // branching in the nav filter.
    expect(nav).not.toContain("anyPermission");
  });
});

describe("the customer can find and read their ticket", () => {
  const profile = source("components/website/MonComptePageClient.jsx");

  test("the ticket renders the QR, the readable code and the seats already used", () => {
    expect(profile).toContain("function CheckInTicket({ reservation, typeLabel })");
    expect(profile).toContain("src={reservation.checkInQr}");
    expect(profile).toContain("{reservation.checkInCode}");
    expect(profile).toContain("reservation.checkedInSeats");
  });

  test("a spent ticket says so instead of looking valid", () => {
    expect(profile).toContain("Billet déjà utilisé");
    expect(profile).toContain("const fullyUsed = checkedIn >= seats");
  });

  test("it warns that a screenshot is not a substitute", () => {
    // Plain apostrophe: the sentence lives in a JS string inside a JSX
    // expression, where &apos; would render as literal "&apos;".
    expect(profile).toContain("une capture d'écran ne le remplace pas");
  });

  test("it is rendered for both ateliers and formations", () => {
    // ReservationCard is shared by both tabs, so one placement covers both.
    expect(profile).toContain("<CheckInTicket reservation={reservation} typeLabel={typeLabel} />");
    expect(profile).toContain('kind="workshop"');
    expect(profile).toContain('kind="formation"');
  });
});
