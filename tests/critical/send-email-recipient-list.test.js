import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn(async () => ({ data: { id: "msg_1" }, error: null }));
vi.mock("resend", () => ({
  Resend: vi.fn(function Resend() {
    this.emails = { send: sendMock };
  }),
}));
vi.mock("@/lib/monitoring", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/campaigns/email-quota", () => ({ recordEmailSent: vi.fn(async () => {}) }));

const { sendEmail } = await import("@/lib/email");

// Invoice / credit-note delivery passes `to` as a list (client + address-book
// copies). The empty-recipient guard added for nullable e-mails must not
// reject those — F-2026-000032 failed with "Missing recipient" on 2026-10-20.
describe("sendEmail recipient guard", () => {
  const prevKey = process.env.RESEND_API_KEY;
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    sendMock.mockClear();
  });
  afterEach(() => {
    process.env.RESEND_API_KEY = prevKey;
  });

  it("accepts a list of recipients", async () => {
    const result = await sendEmail({ to: ["a@example.com", "b@example.com"], subject: "s", text: "t", html: "<p>h</p>" });
    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@example.com", "b@example.com"] }));
  });

  it("accepts a single address", async () => {
    const result = await sendEmail({ to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(result.success).toBe(true);
  });

  it.each([[null], [""], ["  "], [[]], [["", " "]]])("rejects %j", async (to) => {
    const result = await sendEmail({ to, subject: "s", text: "t", html: "<p>h</p>" });
    expect(result).toEqual({ success: false, error: "Missing recipient" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
