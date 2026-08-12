import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("registration error messages", () => {
  test("database connectivity failures are not hidden behind the generic signup error", () => {
    const action = source("actions/auth/register.js");

    expect(action).toContain('error.code === "P1001"');
    // Still its own branch with its own wording, distinct from the catch-all
    // below — the message no longer names the database host, which was an
    // internal detail shown to whoever was trying to sign up.
    expect(action).toContain("Le service est temporairement indisponible");
    expect(action).not.toContain("Neon/DATABASE_URL");
    expect(action.indexOf('error.code === "P1001"')).toBeLessThan(action.indexOf('error.code === "P2002"'));
  });

  test("an email provider failure cannot turn a committed registration into a failed signup", () => {
    const action = source("actions/auth/register.js");
    const form = source("app/(auth)/register/register-form.js");
    const verificationPage = source("app/(auth)/verify-email/page.js");

    expect(action).toContain("let emailDeliveryFailed = false");
    expect(action).toContain("emailDeliveryFailed = !emailResult?.success");
    expect(action).toContain("account created but verification email delivery failed");
    expect(action).toContain("emailDeliveryFailed,");
    expect(form).toContain("response.emailDeliveryFailed");
    expect(form).toContain("/verify-email?");
    expect(verificationPage).toContain('params?.deliveryFailed === "1"');
  });

  test("verification resend reports the real provider result and renders it", () => {
    const action = source("actions/auth/verify-email.js");
    const form = source("app/(auth)/verify-email/verify-email-form.js");

    expect(action).toContain("const emailResult = await sendEmail");
    expect(action).toContain("if (!emailResult?.success)");
    expect(form).toContain("{serverSuccess}");
    expect(form).toContain("{serverError}");
    expect(form).toContain("reset({ email: defaultEmail })");
  });
});
