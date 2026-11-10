import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { GET as runExternalCron } from "@/app/api/cron/route";
import { sendCampaign, sendScheduledCampaigns } from "@/lib/campaigns/send-campaign";

const { submit, getSegmentRecipients } = vi.hoisted(() => ({
  submit: vi.fn(),
  getSegmentRecipients: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: submit }) },
}));
vi.mock("@/lib/campaigns/segments", () => ({
  getSegmentRecipients,
  isValidSegment: () => true,
}));
vi.mock("@/lib/prospects/prospect-service", async (importOriginal) => ({
  ...(await importOriginal()),
  findProspectByEmail: async () => null,
  addActivity: vi.fn(),
  promoteToStatus: vi.fn(),
  syncStatusWithSalonActivity: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ captureError: vi.fn(), captureCriticalError: vi.fn() }));
vi.mock("@/lib/background-jobs", () => ({ refreshInstagramToken: vi.fn(), recordExternalJobRun: vi.fn() }));
vi.mock("@/lib/orders/expire-stale-orders", () => ({ expireStaleOrders: vi.fn(), releaseUnverifiedPickups: vi.fn() }));
vi.mock("@/lib/orders/notify-stale-fulfilment", () => ({ notifyStaleOrderFulfilment: vi.fn() }));
vi.mock("@/lib/reminders/send-workshop-reminders", () => ({ sendWorkshopReservationReminders: vi.fn() }));
vi.mock("@/lib/reminders/send-formation-reminders", () => ({ sendFormationReservationReminders: vi.fn() }));
vi.mock("@/lib/workshops/expire-stale-holds", () => ({ expireStaleWorkshopHolds: vi.fn() }));
vi.mock("@/lib/formations/expire-stale-holds", () => ({ expireStaleFormationHolds: vi.fn() }));
vi.mock("@/lib/payments/reconcile-missed-refunds", () => ({ reconcileMissedRefunds: vi.fn() }));
vi.mock("@/lib/payments/reconcile-missed-checkouts", () => ({ reconcileMissedCheckouts: vi.fn() }));
vi.mock("@/lib/reviews/send-review-requests", () => ({ sendReviewRequests: vi.fn() }));

const hour = 60 * 60_000;
const recipients = (count) => Array.from({ length: count }, (_, i) => ({
  email: `recipient-${i}@example.test`,
  userId: null,
}));

describe("rolling SMTP quota and durable campaigns (PostgreSQL)", () => {
  const campaignIds = [];

  async function createCampaign() {
    const campaign = await prisma.campaign.create({
      data: { title: "Hourly quota test", subject: "Hello", content: "Test content" },
    });
    campaignIds.push(campaign.id);
    return campaign.id;
  }

  const campaignState = (id) => prisma.campaign.findUniqueOrThrow({ where: { id } });
  const countRecipients = (campaignId, status) =>
    prisma.campaignRecipient.count({ where: { campaignId, status } });

  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-only");
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_USER", "sandbox@example.test");
    vi.stubEnv("SMTP_PASSWORD", "fake-password");
    vi.stubEnv("EMAIL_HOURLY_LIMIT", "200");
    submit.mockReset().mockImplementation(async ({ to, messageId }) => ({
      messageId, accepted: [to], rejected: [],
    }));
    getSegmentRecipients.mockReset();
    await prisma.smtpQuotaReservation.deleteMany();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds.splice(0) } } });
    await prisma.smtpQuotaReservation.deleteMany();
  });

  it("sends 200 of 400, leaves 200 pending, and resumes when the rolling window opens", async () => {
    const id = await createCampaign();
    getSegmentRecipients.mockResolvedValue(recipients(400));
    const before = Date.now();
    const first = await sendCampaign(id);
    expect(first).toMatchObject({ sent: 200, queued: 200 });
    expect(+first.resumeAt).toBeGreaterThanOrEqual(before + hour);
    expect(+first.resumeAt).toBeLessThanOrEqual(Date.now() + hour);
    expect(await prisma.campaignRecipient.count({
      where: { campaignId: id, status: "PENDING", attempts: 0 },
    })).toBe(200);

    expect((await sendScheduledCampaigns()).checked).toBe(0);
    expect(submit).toHaveBeenCalledTimes(200);

    // Advance both clocks without waiting an hour. The database controls
    // reservation expiry and the runner clock controls campaign eligibility.
    await prisma.$executeRaw`
      UPDATE "SmtpQuotaReservation" SET "expiresAt" = "expiresAt" - interval '1 hour'
    `;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + hour));
    expect((await sendScheduledCampaigns()).checked).toBe(1);
    expect(submit).toHaveBeenCalledTimes(400);
    expect(new Set(submit.mock.calls.map(([message]) => message.to)).size).toBe(400);
    expect(await campaignState(id)).toMatchObject({ status: "SENT", sentCount: 400 });
  });

  it("resumes an eligible campaign through the authenticated external cron endpoint", async () => {
    vi.stubEnv("JOBS_RUNNER", "external");
    vi.stubEnv("CRON_SECRET", "cron-integration-test");
    const id = await createCampaign();
    getSegmentRecipients.mockResolvedValue(recipients(1));
    await prisma.campaign.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledDate: new Date() },
    });
    const url = "http://localhost/api/cron";
    expect((await runExternalCron(new Request(url))).status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
    const response = await runExternalCron(new Request(url, {
      headers: { authorization: "Bearer cron-integration-test" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scheduledCampaignsChecked: 1, scheduledCampaignsSent: 1 });
    expect(await campaignState(id)).toMatchObject({ status: "SENT", sentCount: 1 });
  });

  it("shares capacity across simultaneous campaigns, duplicate launches and transactional mail", async () => {
    vi.stubEnv("EMAIL_HOURLY_LIMIT", "5");
    const first = await createCampaign();
    const second = await createCampaign();
    getSegmentRecipients.mockResolvedValue(recipients(8));

    // Start a transactional submission and keep it in flight. Its reserved
    // slot must already count before the SMTP call returns.
    let release;
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    submit.mockImplementationOnce(({ to }) => new Promise((resolve) => {
      release = () => resolve({ accepted: [to], rejected: [] });
      started();
    }));
    const transaction = sendEmail({ to: "invoice@example.test", subject: "Invoice", text: "Invoice" });
    await entered;
    try {
      await Promise.all([sendCampaign(first), sendCampaign(first), sendCampaign(second)]);
      expect(submit).toHaveBeenCalledTimes(5);
      expect(await countRecipients(first, "SENT") + await countRecipients(second, "SENT")).toBe(4);
      const messages = submit.mock.calls.map(([message]) => message.messageId).filter(Boolean);
      expect(new Set(messages).size).toBe(4);
    } finally {
      release();
      await transaction;
    }
  });

  it("preserves confirmed sends after restart and does not replay uncertain submissions", async () => {
    const id = await createCampaign();
    const now = new Date();
    await prisma.campaign.update({
      where: { id },
      data: {
        queuedAt: now, scheduledDate: now, status: "SCHEDULED",
        totalSenders: 3, leaseToken: "interrupted-worker", leaseUntil: new Date(+now - 1),
      },
    });
    await prisma.campaignRecipient.createMany({ data: [
      { campaignId: id, email: "confirmed@example.test", status: "SENT" },
      { campaignId: id, email: "uncertain@example.test", status: "SENDING" },
      { campaignId: id, email: "pending@example.test" },
    ] });
    getSegmentRecipients.mockResolvedValue(recipients(4));

    await sendScheduledCampaigns();
    await sendScheduledCampaigns();
    expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "pending@example.test" }));
    expect(await countRecipients(id, "UNKNOWN")).toBe(1);
    expect(await campaignState(id)).toMatchObject({ status: "FAILED", sentCount: 2 });
  });

  it("retries temporary failures after backoff, while permanent and unknown outcomes stay terminal", async () => {
    const id = await createCampaign();
    getSegmentRecipients.mockResolvedValue(recipients(3));
    submit
      .mockRejectedValueOnce(Object.assign(new Error("Try later"), { responseCode: 451 }))
      .mockRejectedValueOnce(Object.assign(new Error("No such user"), { responseCode: 550 }))
      .mockRejectedValueOnce(Object.assign(new Error("Timeout"), { code: "ETIMEDOUT", command: "CONN" }));

    const first = await sendCampaign(id);
    expect(first).toMatchObject({ sent: 0, failed: 1, unknown: 1, queued: 1 });
    expect(submit).toHaveBeenCalledTimes(3);
    expect((await sendScheduledCampaigns()).checked).toBe(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(first.resumeAt);
    await sendScheduledCampaigns();
    expect(submit).toHaveBeenCalledTimes(4);
    expect(submit.mock.calls[3][0].messageId).toBe(submit.mock.calls[0][0].messageId);
    expect(await campaignState(id)).toMatchObject({ status: "FAILED", sentCount: 1 });
  });
});
