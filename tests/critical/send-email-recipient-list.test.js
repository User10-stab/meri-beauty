import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const createTransport = vi.fn(() => ({ sendMail: sendMock }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("@/lib/monitoring", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/campaigns/email-quota", () => ({ recordEmailSent: vi.fn(async () => {}) }));

const { sendEmail } = await import("@/lib/email");

// Invoice / credit-note delivery passes `to` as a list (client + address-book
// copies). The empty-recipient guard added for nullable e-mails must not
// reject those — F-2026-000032 failed with "Missing recipient" on 2026-10-20.
describe("sendEmail recipient guard", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("SMTP_USER", "test@example.com");
    vi.stubEnv("SMTP_PASSWORD", "test-password");
    vi.stubEnv("EMAIL_FROM", "");
    createTransport.mockClear();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ messageId: "msg_1", accepted: ["a@example.com"], rejected: [] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a list of recipients", async () => {
    const result = await sendEmail({ to: ["a@example.com", "b@example.com"], subject: "s", text: "t", html: "<p>h</p>" });
    expect(result).toEqual({ success: true, provider: "smtp", id: "msg_1" });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@example.com", "b@example.com"] }));
  });

  it("accepts a single address", async () => {
    const result = await sendEmail({ to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(result.success).toBe(true);
  });

  it("uses authenticated TLS and forwards attachments and the salon copy", async () => {
    const attachments = [{ filename: "invoice.pdf", content: Buffer.from("invoice") }];
    await sendEmail({ to: "a@example.com", subject: "s", html: "<p>h</p>", attachments, forceCc: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.mail.ovh.net",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: "test@example.com", pass: "test-password" },
    }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: "Meri Beauty", address: "test@example.com" },
      replyTo: "contact@meribeautystudio.com",
      cc: "contact@meribeautystudio.com",
      html: expect.stringContaining("MERI_BEAUTY_EMAIL_SHELL"),
      attachments,
    }));
  });

  it("reports failure when SMTP accepts only the salon copy", async () => {
    sendMock.mockResolvedValue({
      messageId: "msg_1",
      accepted: ["contact@meribeautystudio.com"],
      rejected: ["a@example.com"],
    });
    const result = await sendEmail({ to: "a@example.com", subject: "s", forceCc: true });
    expect(result).toEqual({ success: false, error: "SMTP accepted only the internal copy" });
  });

  it("does not attempt delivery without SMTP credentials", async () => {
    vi.stubEnv("SMTP_PASSWORD", "");
    expect(await sendEmail({ to: "a@example.com", subject: "s" })).toMatchObject({ success: false });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it.each([[null], [""], ["  "], [[]], [["", " "]]])("rejects %j", async (to) => {
    const result = await sendEmail({ to, subject: "s", text: "t", html: "<p>h</p>" });
    expect(result).toEqual({ success: false, error: "Missing recipient" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
