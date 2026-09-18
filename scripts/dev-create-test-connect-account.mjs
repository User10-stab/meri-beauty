/**
 * Creates a Stripe **test-mode** connected account and a staff profile that
 * owns it, so the Connect scenarios in tests/e2e-money can actually run.
 *
 * Why this exists: every connected account in the database belongs to a real
 * independent and lives in Stripe **live** mode. A test-mode secret key cannot
 * see them — `stripe.accounts.retrieve` answers `account_invalid` for all of
 * them — so a direct charge onto one is impossible from a test run, and
 * tests/e2e-money/formation-connect-animatrice.spec.mjs has nothing to book
 * against.
 *
 * It prefers a `custom` account, which this script can activate end to end.
 * If the platform is not yet allowed to create those, it falls back to Express
 * and prints a one-time onboarding link, because Stripe forbids a platform from
 * accepting the Terms of Service for an Express or Standard account. Nothing in
 * the money path cares which type it is — a direct charge is `{ stripeAccount }`
 * either way.
 *
 * Idempotent: re-running reuses the staff profile and its account.
 *
 *   node scripts/dev-create-test-connect-account.mjs
 *
 * Refuses to run against anything but an sk_test_ key.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import bcrypt from "bcrypt";

config({ path: [".env.local", ".env"], quiet: true });

const EMAIL = "e2e.connect.animatrice@meribeauty.test";
const FULL_NAME = "E2E Animatrice Connect";

const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
if (!key.startsWith("sk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY is not an sk_test_ key.");
  process.exit(1);
}

const prisma = new PrismaClient();
const stripe = new Stripe(key);

/**
 * A `custom` account can be activated entirely from here, because the platform
 * is allowed to accept the Terms of Service on its behalf. Express and
 * Standard cannot: Stripe refuses `tos_acceptance` for any account where
 * `controller[requirement_collection]=stripe`, and only the holder can accept
 * them through the hosted onboarding flow.
 *
 * Creating a custom account requires the Connect platform profile to be filled
 * in once, at
 * https://dashboard.stripe.com/settings/connect/platform-profile — Stripe
 * refuses otherwise. When that has not been done, fall back to Express and
 * print the onboarding link for a human to click through with test data.
 */
async function createActivatedAccount() {
  const account = await stripe.accounts.create({
    type: "custom",
    country: "BE",
    email: EMAIL,
    business_type: "individual",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      mcc: "7297",
      // Stripe rejects placeholder domains (example.com) with url_invalid.
      url: "https://meribeautystudio.com",
      product_description: "Formations et ateliers beauté — compte de test e2e.",
    },
    individual: {
      first_name: "Jenny",
      last_name: "Rosen",
      email: EMAIL,
      phone: "+32470000000",
      dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "address_full_match", city: "Bruxelles", postal_code: "1000", country: "BE" },
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
  });

  // A test external account, otherwise payouts stay disabled.
  await stripe.accounts.createExternalAccount(account.id, {
    // A bare IBAN is read as a token id ("No such token"); it has to be the object.
    external_account: { object: "bank_account", country: "BE", currency: "eur", account_number: "BE62510007547061" },
  });
  return stripe.accounts.retrieve(account.id);
}

/** Everything a custom account gets, minus what only the holder may accept. */
async function createExpressAccountForOnboarding() {
  const account = await stripe.accounts.create({
    type: "express",
    country: "BE",
    email: EMAIL,
    business_type: "individual",
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { mcc: "7297", url: "https://meribeautystudio.com" },
  });
  await stripe.accounts.update(account.id, {
    individual: {
      first_name: "Jenny",
      last_name: "Rosen",
      email: EMAIL,
      phone: "+32470000000",
      dob: { day: 1, month: 1, year: 1990 },
      address: { line1: "address_full_match", city: "Bruxelles", postal_code: "1000", country: "BE" },
    },
  });
  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/payments`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/payments`,
  });
  return { account, onboardingUrl: link.url };
}

async function main() {
  const user = await prisma.user.upsert({
    where: { id: (await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } }))?.id ?? "___none___" },
    update: {},
    create: {
      fullName: FULL_NAME,
      email: EMAIL,
      password: await bcrypt.hash("E2eMoney!2026", 12),
      phone: "+32470000000",
      role: "STAFF",
      emailVerified: true,
    },
  });

  let staff = await prisma.staff.findFirst({ where: { userId: user.id } });
  if (staff?.stripeAccountId) {
    try {
      const existing = await stripe.accounts.retrieve(staff.stripeAccountId);
      if (existing.charges_enabled && existing.payouts_enabled) {
        console.log(`Reusing ${staff.stripeAccountId} (charges + payouts enabled).`);
        await linkAnimator(staff);
        return;
      }
      console.log(`${staff.stripeAccountId} is not fully enabled — creating a fresh one.`);
    } catch {
      console.log(`${staff.stripeAccountId} is not reachable with this key — creating a fresh one.`);
    }
  }

  let account;
  let accountType = "custom";
  let onboardingUrl = null;
  try {
    account = await createActivatedAccount();
  } catch (error) {
    if (!/platform-profile/.test(error?.raw?.message ?? "")) throw error;
    console.log(
      "This platform cannot create `custom` accounts yet — its Connect platform profile is incomplete.\n" +
        "Falling back to an Express account, which only its holder can finish activating.",
    );
    ({ account, onboardingUrl } = await createExpressAccountForOnboarding());
    accountType = "express";
  }

  console.log(
    `Created ${account.id} (${accountType}): charges_enabled=${account.charges_enabled} payouts_enabled=${account.payouts_enabled}`,
  );
  if (!account.charges_enabled) {
    console.log("  still pending:", JSON.stringify(account.requirements?.currently_due ?? []));
  }
  if (onboardingUrl) {
    console.log(
      "\nOpen this once and click through with Stripe's test data to activate it:\n" +
        `  ${onboardingUrl}\n` +
        "Then re-run this script — it will pick the account up and record that it can charge.\n" +
        "Alternatively, complete the platform profile at\n" +
        "  https://dashboard.stripe.com/settings/connect/platform-profile\n" +
        "and re-run: the `custom` path needs no clicking at all.",
    );
  }

  staff = staff
    ? await prisma.staff.update({
        where: { id: staff.id },
        data: {
          type: "INDEPENDENT",
          isActive: true,
          stripeAccountId: account.id,
          stripeAccountType: accountType,
          stripeChargesEnabled: account.charges_enabled,
          stripePayoutsEnabled: account.payouts_enabled,
        },
      })
    : await prisma.staff.create({
        data: {
          userId: user.id,
          type: "INDEPENDENT",
          isActive: true,
          // Required by the model, irrelevant to the money path.
          languages: ["fr"],
          yearsOfExperience: 5,
          stripeAccountId: account.id,
          stripeAccountType: accountType,
          stripeChargesEnabled: account.charges_enabled,
          stripePayoutsEnabled: account.payouts_enabled,
        },
      });

  await linkAnimator(staff);
  console.log(`\nStaff ${staff.id} (${FULL_NAME}) is ready to animate a formation.`);
}

/** The link payee resolution reads — without it her seats resolve to the salon. */
async function linkAnimator(staff) {
  const animator = await prisma.animator.upsert({
    where: { email: EMAIL },
    update: { name: FULL_NAME, staffId: staff.id },
    create: { name: FULL_NAME, email: EMAIL, staffId: staff.id },
  });
  console.log(`Animator ${animator.id} -> staff ${staff.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
