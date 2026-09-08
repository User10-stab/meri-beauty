import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { findUnique: vi.fn() },
    // findFirst backs getDashboardPermissions, findUnique backs getStaffId —
    // the real authorization module is used, so what is under test is the
    // actual permission logic and not a restatement of it.
    staff: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
  auth: vi.fn(),
  renderInvoicePdf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/pdf/render", () => ({ renderInvoicePdf: mocks.renderInvoicePdf }));

import { GET } from "@/app/api/invoices/[id]/pdf/route";

const params = Promise.resolve({ id: "inv_1" });
const request = new Request("http://localhost/api/invoices/inv_1/pdf");

function invoiceFor(payment) {
  return { id: "inv_1", number: "2026-001", lines: [], payment };
}

const ORDER_PAYMENT = { order: { userId: "customer_1" } };
const APPOINTMENT_PAYMENT = {
  appointment: { userId: "customer_1", staffService: { staffId: "staff_owner" } },
};
const WORKSHOP_PAYMENT = { workshopReservation: { customerId: "customer_1" } };
const FORMATION_PAYMENT = { formationReservation: { customerId: "customer_1" } };

function asStaff(permissions, { staffId = "staff_owner" } = {}) {
  mocks.auth.mockResolvedValue({ user: { id: "user_staff", role: "STAFF" } });
  mocks.prisma.staff.findFirst.mockResolvedValue({ dashboardPermissions: permissions });
  mocks.prisma.staff.findUnique.mockResolvedValue(staffId ? { id: staffId } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderInvoicePdf.mockResolvedValue(Buffer.from("%PDF-1.4"));
});

/**
 * An invoice PDF carries the customer's name, address, VAT number and every
 * line item. Access used to be a flat "is this a dashboard role" check, so a
 * staff member granted nothing but Rendez-vous could pull any customer's
 * boutique invoice by guessing an id. The permission that gates the screen
 * now gates the document.
 */
describe("staff invoice access is scoped to the work they are authorised for", () => {
  test("an appointments-only staff member cannot read a boutique invoice", async () => {
    asStaff(["APPOINTMENTS"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));

    const response = await GET(request, { params });

    expect(response.status).toBe(403);
    expect(mocks.renderInvoicePdf).not.toHaveBeenCalled();
  });

  test("an orders staff member can", async () => {
    asStaff(["ORDERS"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));

    expect((await GET(request, { params })).status).toBe(200);
  });

  test("so can a cashier who only has the till", async () => {
    // A counter sale's invoice has to be printable by whoever took the money.
    asStaff(["POINT_OF_SALE"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));

    expect((await GET(request, { params })).status).toBe(200);
  });

  test("an appointment invoice is readable only by the staff member whose appointment it is", async () => {
    asStaff(["APPOINTMENTS"], { staffId: "staff_owner" });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(APPOINTMENT_PAYMENT));
    expect((await GET(request, { params })).status).toBe(200);

    vi.clearAllMocks();
    mocks.renderInvoicePdf.mockResolvedValue(Buffer.from("%PDF-1.4"));
    asStaff(["APPOINTMENTS"], { staffId: "staff_someone_else" });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(APPOINTMENT_PAYMENT));
    expect((await GET(request, { params })).status).toBe(403);
  });

  test("a staff member with no staff profile gets nothing rather than everything", async () => {
    asStaff(["APPOINTMENTS"], { staffId: null });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(APPOINTMENT_PAYMENT));

    expect((await GET(request, { params })).status).toBe(403);
  });

  test("atelier and formation invoices follow their own reservation permissions", async () => {
    asStaff(["WORKSHOP_RESERVATIONS"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(WORKSHOP_PAYMENT));
    expect((await GET(request, { params })).status).toBe(200);

    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(FORMATION_PAYMENT));
    expect((await GET(request, { params })).status).toBe(403);

    asStaff(["FORMATION_RESERVATIONS"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(FORMATION_PAYMENT));
    expect((await GET(request, { params })).status).toBe(200);
  });

  test("a payment with no recognisable source is refused, not allowed through", async () => {
    asStaff(["ORDERS", "APPOINTMENTS", "WORKSHOP_RESERVATIONS", "FORMATION_RESERVATIONS"]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor({}));

    expect((await GET(request, { params })).status).toBe(403);
  });
});

describe("the other two audiences are unchanged", () => {
  test("an admin still reads any invoice", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));

    expect((await GET(request, { params })).status).toBe(200);
  });

  test("a customer reads their own and nobody else's", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "customer_1", role: "CUSTOMER" } });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));
    expect((await GET(request, { params })).status).toBe(200);

    mocks.auth.mockResolvedValue({ user: { id: "customer_2", role: "CUSTOMER" } });
    mocks.prisma.invoice.findUnique.mockResolvedValue(invoiceFor(ORDER_PAYMENT));
    expect((await GET(request, { params })).status).toBe(403);
  });

  test("an anonymous request never reaches the database", async () => {
    mocks.auth.mockResolvedValue(null);

    expect((await GET(request, { params })).status).toBe(401);
    expect(mocks.prisma.invoice.findUnique).not.toHaveBeenCalled();
  });
});
