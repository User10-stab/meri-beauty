import { beforeEach, describe, expect, test, vi } from "vitest";

// A formation sent back to "Brouillon" vanishes from the public site, but any
// Stripe link already in a client's inbox stays payable — she is left holding
// a live payment link for a formation she can no longer see, while staff read
// the formation as inactive. Prod, 17/09/2026, "ACOMPTE BASE PRO - Victoria":
// the admin flipped it to draft while the client had an open deposit link.
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  reservationCount: vi.fn(),
  formationUpdate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    formation: { findUnique: mocks.findUnique },
    formationReservation: { count: mocks.reservationCount },
    formationSession: { findMany: mocks.sessionFindMany },
    $transaction: async (fn) =>
      fn({
        formation: { update: mocks.formationUpdate },
        formationSession: { update: mocks.sessionUpdate, deleteMany: mocks.sessionDeleteMany },
      }),
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", email: "admin@meribeauty.com" } }),
}));

vi.mock("@/lib/authorization", async (importOriginal) => ({
  ...(await importOriginal()),
  hasDashboardPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateFormation } = await import("@/actions/formations/create-formation");

const SESSION_ID = "session-1";

/** The one existing session is always carried through in the form payload, so
 *  the unrelated "you cannot remove a booked session" guard never fires. */
function formationInput(status) {
  return {
    id: "formation-1",
    type: "PRIVATE",
    title: "ACOMPTE BASE PRO - Victoria",
    price: 2200,
    duration: 480,
    capacity: 1,
    status,
    depositPercentage: 30,
    sessions: [{ id: SESSION_ID, startDate: "2026-09-22T08:00", capacity: 1 }],
  };
}

function existingFormation(status) {
  return {
    id: "formation-1",
    title: "ACOMPTE BASE PRO - Victoria",
    status,
    animatorId: null,
    sessions: [{ id: SESSION_ID, animatorId: null }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFindMany.mockResolvedValue([]);
  mocks.formationUpdate.mockResolvedValue({ id: "formation-1", sessions: [] });
  mocks.sessionUpdate.mockResolvedValue({});
});

describe("a formation people have booked cannot be sent back to draft", () => {
  test("refuses the switch to DRAFT and does not write anything", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("PUBLISHED"));
    mocks.reservationCount.mockResolvedValue(1);

    const result = await updateFormation(formationInput("DRAFT"));

    expect(result.success).toBe(false);
    expect(result.message).toContain("brouillon");
    // The admin is pointed at the status that hides it without stranding the
    // client — not left guessing why the save failed.
    expect(result.message).toContain("Archivé");
    expect(mocks.formationUpdate).not.toHaveBeenCalled();
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });

  test("counts every reservation on the formation, whatever its status", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("PUBLISHED"));
    mocks.reservationCount.mockResolvedValue(3);

    await updateFormation(formationInput("DRAFT"));

    const [{ where }] = mocks.reservationCount.mock.calls[0];
    // Owner's call (17/09/2026): cancelled and past bookings count too, so a
    // formation people have booked can never quietly disappear. A status
    // filter creeping in here would silently narrow that back down.
    expect(where).toEqual({ session: { formationId: "formation-1" } });
  });

  test("says how many bookings are attached, in the right number", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("PUBLISHED"));

    mocks.reservationCount.mockResolvedValue(1);
    const one = await updateFormation(formationInput("DRAFT"));
    expect(one.message).toContain("1 réservation y est rattachée");

    mocks.reservationCount.mockResolvedValue(4);
    const many = await updateFormation(formationInput("DRAFT"));
    expect(many.message).toContain("4 réservations y sont rattachées");
  });
});

describe("the guard stops exactly there and blocks nothing else", () => {
  test("a formation with no reservation at all still goes to draft", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("PUBLISHED"));
    mocks.reservationCount.mockResolvedValue(0);

    const result = await updateFormation(formationInput("DRAFT"));

    expect(result.success).toBe(true);
    expect(mocks.formationUpdate).toHaveBeenCalled();
  });

  test("editing a formation already in draft is never blocked by its own bookings", async () => {
    // Otherwise the formations that are already in this state on prod would be
    // frozen: no way to fix a title or a date without first publishing them.
    mocks.findUnique.mockResolvedValue(existingFormation("DRAFT"));
    mocks.reservationCount.mockResolvedValue(2);

    const result = await updateFormation(formationInput("DRAFT"));

    expect(result.success).toBe(true);
    expect(mocks.reservationCount).not.toHaveBeenCalled();
    expect(mocks.formationUpdate).toHaveBeenCalled();
  });

  test("« Archivé » stays available as the way to retire a booked formation", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("PUBLISHED"));
    mocks.reservationCount.mockResolvedValue(5);

    const result = await updateFormation(formationInput("ARCHIVED"));

    expect(result.success).toBe(true);
    expect(mocks.formationUpdate).toHaveBeenCalled();
  });

  test("publishing a booked formation again is unaffected", async () => {
    mocks.findUnique.mockResolvedValue(existingFormation("DRAFT"));
    mocks.reservationCount.mockResolvedValue(5);

    const result = await updateFormation(formationInput("PUBLISHED"));

    expect(result.success).toBe(true);
    expect(mocks.formationUpdate).toHaveBeenCalled();
  });
});
