import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

/**
 * /mes-reservations never minted or displayed the appointment check-in QR —
 * unlike /mon-compte's ateliers/formations, getMyReservations() had no
 * attachCheckInQr equivalent at all, so a customer had no way to find their
 * ticket on the one page meant to show it (flagged 2026-08-28: "il ne voit
 * aucun QR code ni sur son email ni sur sa page réservation").
 */
const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: authMock }));

const { prisma } = await import("@/lib/prisma");
const { getMyReservations } = await import("@/actions/reservation/get-my-reservations");

const tag = testTag();
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

function sessionFor(user) {
  return { user: { id: user.id, role: user.role } };
}

describe("a confirmed appointment shows its check-in QR on /mes-reservations", () => {
  let customer, staffUser, staff, category, service, staffService;
  let confirmedAppt, cancelledAppt;

  beforeAll(async () => {
    customer = await prisma.user.create({
      data: { fullName: `${tag}-customer`, email: `${tag}-customer@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
    staffUser = await prisma.user.create({
      data: { fullName: `${tag}-staff`, email: `${tag}-staff@example.test`, phone: uniquePhone(), password: "x", role: "STAFF", emailVerified: true },
    });
    staff = await prisma.staff.create({ data: { userId: staffUser.id, type: "EMPLOYEE", yearsOfExperience: 1 } });
    category = await prisma.category.create({ data: { name: `${tag}-category` } });
    service = await prisma.service.create({
      data: { name: `${tag}-service`, categoryId: category.id },
    });
    staffService = await prisma.staffService.create({
      data: { staffId: staff.id, serviceId: service.id, createdById: staffUser.id, price: 40, duration: 30, photo: "" },
    });

    const base = { userId: customer.id, staffServiceId: staffService.id, staffId: staff.id };
    confirmedAppt = await prisma.appointment.create({
      data: { ...base, date: new Date("2026-09-01"), startTime: new Date("2026-09-01T10:00:00Z"), endTime: new Date("2026-09-01T10:30:00Z"), status: "CONFIRMED" },
    });
    cancelledAppt = await prisma.appointment.create({
      data: { ...base, date: new Date("2026-09-02"), startTime: new Date("2026-09-02T10:00:00Z"), endTime: new Date("2026-09-02T10:30:00Z"), status: "CANCELLED" },
    });

    authMock.mockResolvedValue(sessionFor(customer));
  });

  afterAll(async () => {
    // Defensive: a beforeAll failure partway through must not also hide the
    // real error behind a cascade of "Cannot read properties of undefined".
    if (confirmedAppt || cancelledAppt) {
      await prisma.appointment.deleteMany({ where: { id: { in: [confirmedAppt?.id, cancelledAppt?.id].filter(Boolean) } } });
    }
    if (staffService) await prisma.staffService.delete({ where: { id: staffService.id } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
    if (category) await prisma.category.delete({ where: { id: category.id } });
    if (staff) await prisma.staff.delete({ where: { id: staff.id } });
    if (customer || staffUser) {
      await prisma.user.deleteMany({ where: { id: { in: [customer?.id, staffUser?.id].filter(Boolean) } } });
    }
  });

  test("a CONFIRMED appointment gets a real, scannable code and a QR image", async () => {
    const result = await getMyReservations();
    expect(result.success).toBe(true);

    const row = result.data.find((r) => r.id === confirmedAppt.id);
    expect(row).toBeTruthy();
    // "R-" prefix routes a scanned code to the Appointment table — see
    // lib/activities/check-in-code.js's PREFIXES.
    expect(row.checkInCode).toMatch(/^R-[0-9A-F]{10}$/);
    expect(row.checkInQr).toMatch(/^data:image\/png;base64,/);
    expect(row.checkedInAt).toBeNull();

    // Re-reading must return the SAME code — ensureCheckInCode is meant to
    // mint once, not hand out a new ticket on every page load.
    const second = await getMyReservations();
    expect(second.data.find((r) => r.id === confirmedAppt.id).checkInCode).toBe(row.checkInCode);
  });

  test("a cancelled appointment shows no ticket — a closed door must not look open", async () => {
    const result = await getMyReservations();
    const row = result.data.find((r) => r.id === cancelledAppt.id);
    expect(row.checkInCode).toBeNull();
    expect(row.checkInQr).toBeNull();
  });
});
