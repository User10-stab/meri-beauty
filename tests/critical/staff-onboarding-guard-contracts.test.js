import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0 (17 Aug 2026): staff reported "I can't add a Stripe account, it keeps
// switching me back". Every staff row has allowedPaymentMethods=BOTH and no
// connected account, so stripeRequired was true for all of them, and the
// guard redirected to /dashboard/payments on every navigation. The only exit
// was completing a Connect flow that fails for reasons staff cannot fix (the
// platform account has never signed up for Connect), so the whole dashboard
// was unreachable.
describe("staff onboarding never traps a staff member", () => {
  test("the guard does not redirect to /dashboard/payments", () => {
    const guard = source("components/dashboard/onboarding/OnboardingGuard.jsx");
    expect(guard).not.toMatch(/router\.replace\(\s*["'`]\/dashboard\/payments/);
  });

  test("the Stripe step is dismissible, the account step is not", () => {
    const guard = source("components/dashboard/onboarding/OnboardingGuard.jsx");

    // Stripe step gets an onDismiss and is suppressed once dismissed.
    expect(guard).toContain("stripeDismissed");
    expect(guard).toMatch(/step="stripe"[^/]*onDismiss/);

    // The account step stays blocking — it is escapable by filling three
    // fields, so gating on it is legitimate.
    expect(guard).not.toMatch(/step="account"[^/]*onDismiss/);
  });

  test("incomplete account setup still redirects to account-settings", () => {
    const guard = source("components/dashboard/onboarding/OnboardingGuard.jsx");
    expect(guard).toContain('router.replace("/dashboard/account-settings")');
  });
});

// The modal listed four fixed items ("Profil / Contrat / Paramètres de
// réservation / Horaires de travail") with an identical grey tick on each,
// while the real gate was languages && contracts && workingHours. A staff
// member who filled in their photo and bio saw no change and no indication
// that the actual blocker was "add a language" — hence "this popup shows up
// every time".
describe("the onboarding checklist reflects reality", () => {
  test("status returns per-step state matching the gate it computes", () => {
    const action = source("actions/staff/check-onboarding-status.js");

    expect(action).toContain("const setupCompleted = hasLanguages && hasContract && hasWorkingHours");

    // Every step shown must be one the gate actually tests.
    expect(action).toMatch(/key: "languages",[^}]*done: hasLanguages/);
    expect(action).toMatch(/key: "contract",[^}]*done: hasContract/);
    expect(action).toMatch(/key: "workingHours",[^}]*done: hasWorkingHours/);
  });

  test("the ungated 'Paramètres de réservation' item is no longer advertised", () => {
    const action = source("actions/staff/check-onboarding-status.js");
    const modal = source("components/dashboard/onboarding/OnboardingModal.jsx");

    // It was never part of setupCompleted, so promising it blocks entry was
    // simply wrong.
    expect(action).not.toContain("Paramètres de réservation");
    expect(modal).not.toContain("Paramètres de réservation");
  });

  test("the language requirement is spelled out rather than hidden behind 'Profil'", () => {
    const action = source("actions/staff/check-onboarding-status.js");
    expect(action).toMatch(/langue/i);
  });

  test("the modal renders each step's real done state", () => {
    const modal = source("components/dashboard/onboarding/OnboardingModal.jsx");
    expect(modal).toContain("function StepRow");
    expect(modal).toContain("done ? CheckCircle2 : Circle");
    expect(modal).toMatch(/steps\?\.length \? steps : ACCOUNT_STEPS_FALLBACK/);
  });
});

// Both Stripe entry points failed with messages the staff member could do
// nothing with: a bare 500 ("Erreur de connexion au serveur") for missing
// env vars, and a generic "Erreur lors de la création" when the platform has
// not signed up for Connect.
describe("Stripe setup failures name the actual problem", () => {
  test("missing OAuth env vars report a configuration gap, not a server fault", () => {
    const route = source("app/api/stripe/oauth/authorize/route.js");
    expect(route).toContain('error?.message?.includes("is not configured")');
    expect(route).toContain("STRIPE_CONNECT_CLIENT_ID");
    // A config gap is a 4xx, not a 500.
    expect(route).toMatch(/is not configured[\s\S]{0,200}badRequest/);
  });

  test("a platform that has not enabled Connect says so", () => {
    const action = source("actions/stripe/createConnectAccount.js");
    expect(action).toContain('stripeMessage.includes("signed up for Connect")');
    expect(action).toContain("dashboard.stripe.com/connect");
  });
});
