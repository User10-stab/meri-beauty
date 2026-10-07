import { beforeEach, describe, expect, test, vi } from "vitest";

// Manual booking must apply the exact same availability rules as the public
// flow (validateAppointmentSlot + shared getAvailableSlots) and must never
// silently duplicate — or reuse — an existing client when staff type a
// "new" e-mail that already belongs to an active account.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  staffServiceFindFirst: vi.fn(),
  salonFindUnique: vi.fn(),
  appointmentFindMany: vi.fn(),
  appointmentCreate: vi.fn(),
  userFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  sendEmail: vi.fn(),
  createNotificationsBulk: vi.fn(),
  buildAppointmentConfirmedNotification: vi.fn(),
  getAppointmentNotificationRecipients: vi.fn(),
  getAppointmentEmailRecipients: vi.fn(),
  buildAppointmentCheckInEmailAssets: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications", () => ({
  createNotificationsBulk: mocks.createNotificationsBulk,
  buildAppointmentConfirmedNotification: mocks.buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients: mocks.getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients: mocks.getAppointmentEmailRecipients,
}));
vi.mock("@/lib/activities/appointment-check-in-qr", () => ({
  buildAppointmentCheckInEmailAssets: mocks.buildAppointmentCheckInEmailAssets,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    staffService: { findFirst: mocks.staffServiceFindFirst },
    salon: { findUnique: mocks.salonFindUnique },
    // validateAppointmentSlot also reads the formation/atelier sessions the
    // staff member animates (lib/formations/staff-session-blocks.js); this
    // staff member animates none.
    staff: { findMany: async () => [] },
    appointment: {
      findMany: mocks.appointmentFindMany,
      create: mocks.appointmentCreate,
    },
    user: {
      findFirst: mocks.userFindFirst,
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
      update: mocks.userUpdate,
    },
  },
}));

const { createManualAppointment, createManualAppointments } = await import(
  "@/actions/appointment/create-manual-appointment.js"
);

// A Thursday strictly in the future (past slots are rejected by everyone).
function futureThursday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 4);
  return d;
}
const DAY = futureThursday();
const DATE_KEY = `${DAY.getFullYear()}-${String(DAY.getMonth() + 1).padStart(2, "0")}-${String(DAY.getDate()).padStart(2, "0")}`;
const at = (h, m = 0) => {
  const d = new Date(DAY);
  d.setHours(h, m, 0, 0);
  return d;
};

function staffServiceFixture({ timeOffs = [] } = {}) {
  return {
    id: "ss-1",
    staffId: "staff-1",
    isActive: true,
    isDeleted: false,
    price: 50,
    duration: 60,
    service: { id: "svc-1", name: "Coupe" },
    staff: {
      id: "staff-1",
      isActive: true,
      isDeleted: false,
      user: { fullName: "Marie Mercier", isDeleted: false },
      reservationConfirmationMode: "MANUAL",
      depositEnabled: false,
      depositPercentage: 0,
      allowedPaymentMethods: "BOTH",
      stripeAccountId: null,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      workingHours: [{ day: "THURSDAY", startTime: "09:00", endTime: "18:00", isClosed: false }],
      timeOffs,
      contracts: [{ status: "ACTIVE", startDate: new Date("2025-01-01"), endDate: null }],
    },
  };
}

const NEW_CUSTOMER = { fullName: "Jean Client", email: "jean.client@example.com", phone: "+32470123456" };

function baseInput(overrides = {}) {
  return {
    staffId: "staff-1",
    staffServiceId: "ss-1",
    date: DATE_KEY,
    time: "10:00",
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  mocks.staffServiceFindFirst.mockResolvedValue(staffServiceFixture());
  mocks.salonFindUnique.mockResolvedValue({});
  mocks.appointmentFindMany.mockResolvedValue([]);
  mocks.appointmentCreate.mockImplementation(async ({ data }) => ({ id: "appt-1", ...data }));
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.userCreate.mockImplementation(async ({ data }) => ({ id: "user-new", ...data }));
  mocks.userUpdate.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.createNotificationsBulk.mockResolvedValue([]);
  mocks.buildAppointmentConfirmedNotification.mockReturnValue({});
  mocks.getAppointmentNotificationRecipients.mockResolvedValue([]);
  mocks.getAppointmentEmailRecipients.mockResolvedValue([]);
  mocks.buildAppointmentCheckInEmailAssets.mockResolvedValue({ checkInCode: "R-TEST" });
});

describe("manual booking — new-client e-mail guard (server-side)", () => {
  test("1. a client with a new e-mail can be created", async () => {
    const res = await createManualAppointment({ ...baseInput(), customer: { ...NEW_CUSTOMER } });

    expect(res.success).toBe(true);
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    const [{ data }] = mocks.userCreate.mock.calls[0];
    expect(data.email).toBe("jean.client@example.com");
    expect(data.role).toBe("CUSTOMER");
    expect(mocks.appointmentCreate).toHaveBeenCalledTimes(1);
  });

  test("2. a client with an already-used e-mail is NOT created", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "user-existing", email: "jean.client@example.com" });

    const res = await createManualAppointment({ ...baseInput(), customer: { ...NEW_CUSTOMER } });

    expect(res.success).toBe(false);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
  });

  test("3. the specific error message reaches the UI (toast + inline field)", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "user-existing", email: "jean.client@example.com" });

    const res = await createManualAppointment({ ...baseInput(), customer: { ...NEW_CUSTOMER } });

    expect(res.success).toBe(false);
    expect(res.message).toBe(
      "Cette adresse e-mail est déjà utilisée par un client existant. Veuillez sélectionner le client existant plutôt que de créer un nouveau compte."
    );
    // Inline form error under the Client field + conventional field marker.
    expect(res.errors.customer).toBe(res.message);
    expect(res.field).toBe("email");
  });

  test("a soft-deleted account does not block e-mail reuse", async () => {
    // findFirst is always scoped isDeleted:false (active-only rule) — a
    // deleted namesake resolves to null and creation proceeds.
    mocks.userFindFirst.mockResolvedValue(null);

    const res = await createManualAppointment({ ...baseInput(), customer: { ...NEW_CUSTOMER } });

    expect(res.success).toBe(true);
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    const [{ where }] = mocks.userFindFirst.mock.calls[0];
    expect(where.isDeleted).toBe(false);
  });
});

describe("manual booking — same availability rules as the normal flow", () => {
  test("4. a manual booking on an unavailable slot is refused", async () => {
    // Full-day TimeOff covering the requested 10:00 slot.
    mocks.staffServiceFindFirst.mockResolvedValue(
      staffServiceFixture({ timeOffs: [{ startDate: at(0, 0), endDate: at(23, 59), isFullDay: true }] })
    );
    mocks.userFindUnique.mockResolvedValue({ id: "user-existing", role: "CUSTOMER", isDeleted: false });

    const res = await createManualAppointment({
      ...baseInput(),
      customer: { userId: "user-existing" },
    });

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/disponible|creneau|créneau|congé|working|jour/i);
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
  });

  test("5. a manual booking on an available slot works normally", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-existing", role: "CUSTOMER", isDeleted: false });

    const res = await createManualAppointment({
      ...baseInput(),
      customer: { userId: "user-existing" },
    });

    expect(res.success).toBe(true);
    expect(mocks.appointmentCreate).toHaveBeenCalledTimes(1);
    const [{ data }] = mocks.appointmentCreate.mock.calls[0];
    expect(data.userId).toBe("user-existing");
    expect(data.staffId).toBe("staff-1");
    expect(data.status).toBe("CONFIRMED");
    expect(data.startTime.getHours()).toBe(10);
  });
});

describe("manual booking — several prestations for one client", () => {
  // Marie does "ss-1" (1h + 15 min of rest); Julie does "ss-2".
  function twoStaffServices() {
    const marie = { ...staffServiceFixture(), margin: 15 };
    const base = staffServiceFixture();
    const julie = {
      ...base,
      id: "ss-2",
      staffId: "staff-2",
      service: { id: "svc-2", name: "Pédicure" },
      staff: { ...base.staff, id: "staff-2", user: { fullName: "Julie Dupont", isDeleted: false } },
    };
    mocks.staffServiceFindFirst.mockImplementation(async ({ where }) => (where.id === "ss-2" ? julie : marie));
  }

  beforeEach(() => {
    twoStaffServices();
    mocks.userFindUnique.mockResolvedValue({
      id: "user-existing",
      role: "CUSTOMER",
      isDeleted: false,
      email: "cliente@example.com",
      fullName: "Cliente",
    });
    let n = 0;
    mocks.appointmentCreate.mockImplementation(async ({ data }) => ({ id: `appt-${++n}`, ...data }));
  });

  const item = (overrides = {}) => ({ staffId: "staff-1", staffServiceId: "ss-1", date: DATE_KEY, time: "10:00", ...overrides });
  const book = (items) => createManualAppointments({ items, notes: null, customer: { userId: "user-existing" } });

  test("two staff members: one appointment each, one e-mail per prestation to the client and to each staff", async () => {
    mocks.getAppointmentEmailRecipients.mockImplementation(async (staffId) => [
      { email: `${staffId}@example.com`, fullName: staffId },
    ]);

    const res = await book([item(), item({ staffId: "staff-2", staffServiceId: "ss-2", time: "10:30" })]);

    expect(res.success).toBe(true);
    expect(res.data.appointments).toHaveLength(2);
    expect(mocks.appointmentCreate.mock.calls.map(([{ data }]) => data.staffId)).toEqual(["staff-1", "staff-2"]);
    const recipients = mocks.sendEmail.mock.calls.map(([mail]) => mail.to);
    expect(recipients.filter((to) => to === "cliente@example.com")).toHaveLength(2);
    expect(recipients).toContain("staff-1@example.com");
    expect(recipients).toContain("staff-2@example.com");
  });

  test("same staff member: the second prestation may not start inside the first one's rest time", async () => {
    // 10:00–11:00 + 15 min of rest: 11:00 is still hers to recover.
    const res = await book([item(), item({ time: "11:00" })]);

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/se chevauchent/);
    expect(res.itemIndex).toBe(1);
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  test("same staff member: a prestation after the rest time is accepted", async () => {
    const res = await book([item(), item({ time: "11:30" })]);

    expect(res.success).toBe(true);
    expect(mocks.appointmentCreate).toHaveBeenCalledTimes(2);
  });

  test("one invalid prestation refuses the whole booking — nothing is written", async () => {
    const res = await book([item(), item({ staffId: "staff-2", staffServiceId: "ss-2", time: "23:00" })]);

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/^Prestation 2 : /);
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
  });
});
