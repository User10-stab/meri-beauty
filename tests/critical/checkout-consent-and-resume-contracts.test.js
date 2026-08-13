import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// A guest whose 15-minute verification link expired clicks "renvoyer" — the
// one action that exists precisely because the first link died. The resend
// used to mint a bare token, so they verified their address and the order or
// reservation they had already created was never resumed, never paid, and
// expired along with its stock/seat hold.
describe("resending a verification email keeps the checkout attached", () => {
  const actions = source("actions/auth/verify-email.js");
  const resend = actions.slice(actions.indexOf("export async function resendVerificationEmail"));

  test("the replacement token carries resumeType and resumeId forward", () => {
    expect(resend).toContain("resumeType: pendingCheckout?.resumeType ?? null");
    expect(resend).toContain("resumeId: pendingCheckout?.resumeId ?? null");
  });

  test("the pending checkout is read before the cleanup that would delete it", () => {
    const lookupIdx = resend.indexOf("const pendingCheckout");
    const deleteIdx = resend.indexOf("emailVerificationToken.deleteMany");
    expect(lookupIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(lookupIdx);
  });

  test("expired tokens still qualify — that is the whole point of a resend", () => {
    // Filtering on `used` only. An expiresAt filter here would skip exactly
    // the row this needs to read.
    expect(resend).toContain("where: { email: user.email, used: false, resumeType: { not: null } }");
  });

  test("the most recent pending checkout wins", () => {
    expect(resend).toContain('orderBy: { createdAt: "desc" }');
  });
});

// Every checkout form already rendered a "j'accepte les CGV" checkbox, but the
// check lived entirely in the client component. Server actions are public POST
// endpoints, so the order went through either way — and nothing was persisted,
// leaving no evidence of consent for any guest who never registered.
describe("CGV consent is enforced and recorded at every purchase, not just signup", () => {
  // [action file, file carrying the rejection] — the boutique validates through
  // its Zod checkout schema, the others guard inline.
  const FLOWS = [
    ["actions/boutique/orders.js", "lib/validations/commerce.js"],
    ["actions/workshops/create-workshop-reservation.js", "actions/workshops/create-workshop-reservation.js"],
    ["actions/formations/create-formation-reservation.js", "actions/formations/create-formation-reservation.js"],
    ["actions/reservation/create-reservation.js", "actions/reservation/create-reservation.js"],
    ["actions/payment/createCheckoutSession.js", "actions/payment/createCheckoutSession.js"],
  ];

  test.each(FLOWS)("%s rejects a purchase without consent", (_file, guardFile) => {
    const content = source(guardFile);
    const rejects =
      content.includes("termsAccepted !== true") ||
      content.includes("termsAccepted: termsAcceptedSchema");
    expect(rejects).toBe(true);
  });

  test.each(FLOWS)("%s persists the acceptance", (file) => {
    expect(source(file)).toContain("recordTermsAcceptance");
  });

  test("a newly created guest account carries the acceptance from the start", () => {
    for (const file of [
      "actions/boutique/orders.js",
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
      "actions/reservation/create-reservation.js",
      "actions/payment/createCheckoutSession.js",
    ]) {
      expect(source(file)).toContain("buildTermsAcceptanceUpdate()");
    }
  });

  test("both appointment entry points are guarded, not just the single one", () => {
    const content = source("actions/reservation/create-reservation.js");
    const matches = content.match(/termsAccepted !== true/g);
    expect(matches).toHaveLength(2); // createReservation + createMultipleReservations
  });

  test("the refusal message reaches the customer in French", () => {
    // Zod 4 ignores `errorMap`; only `error` is honoured at runtime.
    const lib = source("lib/terms-consent.js");
    expect(lib).toContain("error: TERMS_CONSENT_REQUIRED_MESSAGE");
    expect(lib).not.toContain("errorMap:");
  });

  test("re-recording is gated so termsAcceptedAt is not reset on every order", () => {
    const lib = source("lib/terms-consent.js");
    expect(lib).toContain("{ termsAcceptedAt: null }");
    expect(lib).toContain("{ termsAcceptedVersion: { not: TERMS_CONSENT_VERSION } }");
    // updateMany, so a missing row is a no-op rather than a throw.
    expect(lib).toContain("client.user.updateMany");
  });

  test("the consent version matches the CGV the customer is shown", () => {
    const lib = source("lib/terms-consent.js");
    expect(lib).toContain('TERMS_CONSENT_VERSION = "2026-08-12"');
    expect(source("app/(public)/cgv/page.jsx")).toContain('updated="12 août 2026"');
  });

  test("every checkout form actually sends the flag", () => {
    for (const file of [
      "components/boutique/CheckoutPageClient.jsx",
      "components/reservation/steps/PaymentStep.jsx",
      "components/reservation/steps/ReviewStep.jsx",
      "app/(public)/reservation-atelier/page.js",
      "app/(public)/reservation-formation/page.js",
    ]) {
      expect(source(file)).toContain("termsAccepted: acceptedTerms");
    }
  });
});

// The salon serves a French-speaking clientele in Brussels; the auth screens
// were the last surface still shipping English copy.
describe("the auth surface speaks French", () => {
  const FILES = [
    "app/(auth)/login/login-form.js",
    "app/(auth)/login/page.js",
    "app/(auth)/register/register-form.js",
    "app/(auth)/register/page.js",
    "app/(auth)/forgot-password/forgot-password-form.js",
    "app/(auth)/forgot-password/page.js",
    "app/(auth)/reset-password/reset-password-form.js",
    "app/(auth)/reset-password/page.js",
    "app/(auth)/verify-email/verify-email-form.js",
    "app/(auth)/verify-email/page.js",
    "components/auth-form.js",
    "actions/auth/login.js",
    "actions/auth/register.js",
    "actions/auth/forgot-password.js",
    "actions/auth/reset-password.js",
    "actions/auth/verify-email.js",
    "lib/validations/login.js",
    "lib/validations/register.js",
    "lib/validations/reset-password.js",
    "lib/validations/forgot-password.js",
    "lib/validations/resend-verification.js",
  ];

  // Phrases that were actually on screen. Comments are stripped first so
  // English explanatory comments — which are the house style — don't trip this.
  const ENGLISH = [
    "Sign In",
    "Sign in to",
    "Back to Sign In",
    "Remember me",
    "Forgot password?",
    "Create an account",
    "Create Account",
    "Email Address",
    "Email Verified",
    "Verification Failed",
    "Verify Your Email",
    "Resend Verification Email",
    "Invalid email or password",
    "Please enter a valid email",
    "Something went wrong",
    "Too many attempts",
    "Too many requests",
    "Account created successfully",
    "already registered",
    "must be at least",
    "must be at most",
    "Passwords do not match",
  ];

  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  test.each(FILES)("%s has no leftover English UI copy", (file) => {
    const content = stripComments(source(file));
    const found = ENGLISH.filter((phrase) => content.includes(phrase));
    expect(found).toEqual([]);
  });

  test("the register form no longer suggests a US phone number", () => {
    const form = source("app/(auth)/register/register-form.js");
    expect(form).not.toContain("+1 234 567 8900");
    expect(form).toContain("+32 470 12 34 56");
  });

  test("an internal database hostname is not shown to the person signing up", () => {
    expect(source("actions/auth/register.js")).not.toContain("Neon/DATABASE_URL");
  });
});
