import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Staff billing runs once per Brussels day, on the first 5-minute tick after
 * midnight — no longer every 24h counted from the last restart, which made a
 * rent due on the 1st appear at whatever hour the app had been deployed
 * (user, 2026-10-01).
 */

const day = { year: 2026, month: 9, day: 30 };
const billing = vi.fn();

vi.mock("@/lib/staff-monthly-billing", () => ({
  sendDailyStaffInvoices: (...args) => billing(...args),
  todayInBrussels: () => ({ ...day }),
}));
const noop = () => vi.fn(async () => ({}));
vi.mock("@/lib/orders/expire-stale-orders", () => ({ expireStaleOrders: noop(), releaseUnverifiedPickups: noop() }));
vi.mock("@/lib/orders/notify-stale-fulfilment", () => ({ notifyStaleOrderFulfilment: noop() }));
vi.mock("@/lib/reminders/send-workshop-reminders", () => ({ sendWorkshopReservationReminders: noop() }));
vi.mock("@/lib/reminders/send-formation-reminders", () => ({ sendFormationReservationReminders: noop() }));
vi.mock("@/lib/reminders/send-appointment-reminders", () => ({ sendAppointmentReminders: noop() }));
vi.mock("@/lib/appointments/notify-unsettled-appointments", () => ({ notifyUnsettledAppointments: noop() }));
vi.mock("@/lib/appointments/expire-stale-appointments", () => ({ expireStalePendingAppointments: noop() }));
vi.mock("@/lib/workshops/expire-stale-holds", () => ({ expireStaleWorkshopHolds: noop() }));
vi.mock("@/lib/formations/expire-stale-holds", () => ({ expireStaleFormationHolds: noop() }));
vi.mock("@/lib/payments/reconcile-missed-refunds", () => ({ reconcileMissedRefunds: noop() }));
vi.mock("@/lib/payments/reconcile-missed-checkouts", () => ({ reconcileMissedCheckouts: noop() }));
vi.mock("@/lib/campaigns/send-campaign", () => ({ sendScheduledCampaigns: noop() }));
vi.mock("@/lib/cash-book/auto-session", () => ({ autoCloseCashSession: noop() }));
vi.mock("@/lib/monitoring", () => ({ captureCriticalError: vi.fn() }));

const TICK = 5 * 60 * 1000;

describe("staff billing schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    delete globalThis.__meriBackgroundJobsStarted;
    delete globalThis.__meriJobsHeartbeat;
    Object.assign(day, { year: 2026, month: 9, day: 30 });
    billing.mockReset();
    billing.mockResolvedValue({ errors: 0, generated: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at boot, not again the same day, then on the first tick after midnight", async () => {
    const { startBackgroundJobs } = await import("@/lib/background-jobs");
    startBackgroundJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(billing).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(billing).toHaveBeenCalledTimes(1);

    Object.assign(day, { month: 10, day: 1 });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(billing).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(billing).toHaveBeenCalledTimes(2);
  });

  it("retries on the next tick when a run throws", async () => {
    billing.mockRejectedValueOnce(new Error("db down"));
    const { startBackgroundJobs } = await import("@/lib/background-jobs");
    startBackgroundJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(billing).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(billing).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(billing).toHaveBeenCalledTimes(2);
  });
});
