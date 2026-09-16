import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sendEmail: vi.fn(),
  writeAuditLog: vi.fn(),
  prisma: {
    staff: { findFirst: vi.fn(), findUnique: vi.fn() },
    appointment: { findFirst: vi.fn() },
    workshopReservation: { findFirst: vi.fn() },
    formationReservation: { findFirst: vi.fn() },
    payment: { findUnique: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/qrcode", () => ({ qrPngAttachment: vi.fn(async (code, filename) => ({ filename, content: "png" })) }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { CHECKIN_TICKET_EMAILED: "CHECKIN_TICKET_EMAILED" },
  writeAuditLog: mocks.writeAuditLog,
}));

import { resendCheckInQr, sendCheckInEmail } from "@/actions/payments/send-checkin-email";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const JULIE = { id: "u_julie", role: "STAFF", email: "julieschoemans@gmail.com" };
const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com" };

const APPOINTMENT = {
  checkInCode: "RDV123",
  date: new Date("2026-09-20T09:00:00Z"),
  user: { fullName: "Cliente", email: "cliente@example.com" },
  staffService: { staffId: "s_julie", service: { name: "Brushing" } },
};
const WORKSHOP_RESERVATION = {
  checkInCode: "ATL123",
  customer: { fullName: "Cliente", email: "cliente@example.com" },
  session: { startDate: new Date("2026-09-21T09:00:00Z"), workshop: { title: "Atelier maquillage" } },
};

function signedInAs(user, { permissions = [], staffId = null } = {}) {
  mocks.auth.mockResolvedValue({ user });
  mocks.prisma.staff.findFirst.mockResolvedValue({ dashboardPermissions: permissions });
  mocks.prisma.staff.findUnique.mockResolvedValue(staffId ? { id: staffId } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendEmail.mockResolvedValue({ success: true });
});

/**
 * The check-in QR is the client's proof of a paid booking. Unlike the ticket
 * (a salon fiscal document, admin + Marie only), every staff member must be
 * able to put it back in the client's inbox — for the bookings she can see.
 */
describe("staff can resend the check-in QR of their own bookings", () => {
  it("an independent resends the QR of her own rendez-vous, to the booking's client", async () => {
    signedInAs(JULIE, { permissions: ["APPOINTMENTS"], staffId: "s_julie" });
    mocks.prisma.appointment.findFirst.mockResolvedValue(APPOINTMENT);

    const result = await resendCheckInQr({ kind: "APPOINTMENT", id: "apt_1" });

    expect(result.success).toBe(true);
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("cliente@example.com");
    expect(mail.attachments?.[0]?.filename).toBe("billet-rendez-vous-RDV123.png");
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("but not a colleague's rendez-vous", async () => {
    signedInAs(JULIE, { permissions: ["APPOINTMENTS"], staffId: "s_julie" });
    mocks.prisma.appointment.findFirst.mockResolvedValue({ ...APPOINTMENT, staffService: { ...APPOINTMENT.staffService, staffId: "s_rose" } });

    expect((await resendCheckInQr({ kind: "APPOINTMENT", id: "apt_2" })).success).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("an atelier booking is looked up within her own sessions only", async () => {
    signedInAs(JULIE, { permissions: ["WORKSHOP_RESERVATIONS"] });
    mocks.prisma.workshopReservation.findFirst.mockResolvedValue(WORKSHOP_RESERVATION);

    expect((await resendCheckInQr({ kind: "WORKSHOP", id: "wr_1" })).success).toBe(true);
    const where = mocks.prisma.workshopReservation.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe("wr_1");
    expect(where.session).toBeDefined();
  });

  it("a staff member without the reservation permission gets nothing", async () => {
    signedInAs(JULIE, { permissions: ["APPOINTMENTS"] });

    expect((await resendCheckInQr({ kind: "FORMATION", id: "fr_1" })).success).toBe(false);
    expect(mocks.prisma.formationReservation.findFirst).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("Marie resends any booking's QR, unscoped", async () => {
    signedInAs(MARIE);
    mocks.prisma.workshopReservation.findFirst.mockResolvedValue(WORKSHOP_RESERVATION);

    expect((await resendCheckInQr({ kind: "WORKSHOP", id: "wr_2" })).success).toBe(true);
    expect(mocks.prisma.workshopReservation.findFirst.mock.calls[0][0].where).toEqual({ id: "wr_2" });
  });

  it("a booking with no QR yet says so instead of sending an empty e-mail", async () => {
    signedInAs(JULIE, { permissions: ["APPOINTMENTS"], staffId: "s_julie" });
    mocks.prisma.appointment.findFirst.mockResolvedValue({ ...APPOINTMENT, checkInCode: null });

    const result = await resendCheckInQr({ kind: "APPOINTMENT", id: "apt_3" });
    expect(result.success).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("the Opérations drawer's payment-based resend stays salon-only", async () => {
    signedInAs(JULIE, { permissions: ["APPOINTMENTS", "WORKSHOP_RESERVATIONS"] });
    expect((await sendCheckInEmail("pay_1")).success).toBe(false);
    expect(mocks.prisma.payment.findUnique).not.toHaveBeenCalled();
  });
});

describe("the resend is reachable from the staff screens", () => {
  it("rendez-vous, ateliers and formations each offer it", () => {
    expect(source("components/dashboard/appointments/AppointmentsPageClient.jsx")).toContain('resendCheckInQr({ kind: "APPOINTMENT", id: appointmentId })');
    expect(source("components/dashboard/workshops/ReservationsPageClient.jsx")).toContain('resendCheckInQr({ kind: "WORKSHOP", id: row.id })');
    expect(source("components/dashboard/formations/ReservationsPageClient.jsx")).toContain('resendCheckInQr({ kind: "FORMATION", id: row.id })');
    for (const folder of ["workshops", "formations"]) {
      expect(source(`components/dashboard/${folder}/ReservationRow.jsx`)).toContain("onSendCheckIn(row)");
    }
  });
});
