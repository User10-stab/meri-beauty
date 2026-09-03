/**
 * The rails that make it safe to run real payments from a test suite.
 *
 * This suite deliberately runs against the *dev* database and the *shared*
 * Stripe test key, which means it creates genuine Payment/Invoice/CreditNote
 * rows and genuine Stripe charges. That is an acceptable trade only while it
 * is structurally impossible to point it at anything that matters, so these
 * four checks run before a single browser opens and abort the whole run
 * rather than skip.
 *
 * None of them is a formality:
 *
 *   DATABASE_URL      Production is self-hosted Postgres on an OVH VPS; only
 *                     dev is on Neon. Requiring a neon.tech host is therefore
 *                     a positive assertion of "this is the dev database",
 *                     not merely the absence of a production marker.
 *   STRIPE_SECRET_KEY The same rail scripts/dev-with-stripe-webhooks.mjs
 *                     already enforces before starting the CLI listener.
 *   NODE_ENV          Belt and braces behind the two above.
 *   EMAIL_PROVIDER    The dev database holds real customer rows. Every other
 *                     side effect here is reversible; an e-mail sent to a
 *                     real address is not. Mailpit is an isolated local
 *                     inbox (lib/email.js routes to it and refuses to do so
 *                     in production).
 */

const REQUIRED_DB_HOST = "neon.tech";

/** Host only — never the credentials, which must not reach a log or a report. */
function hostOf(connectionString) {
  try {
    return new URL(connectionString).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ requireMailpit?: boolean }} [options] - the e-mail rail is about
 *   *sending*, so a tool that only reads or deletes rows (the purge script)
 *   opts out of it rather than demanding a mail configuration it never uses.
 * @returns {string[]} human-readable reasons this environment is unsafe
 */
export function findUnsafeMoneyTestEnv(env = process.env, { requireMailpit = true } = {}) {
  const problems = [];

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    problems.push("DATABASE_URL is not set.");
  } else if (!hostOf(databaseUrl).includes(REQUIRED_DB_HOST)) {
    problems.push(
      `DATABASE_URL host is "${hostOf(databaseUrl) || "unparseable"}", which is not a ${REQUIRED_DB_HOST} ` +
        "host. Production is self-hosted Postgres on OVH — this suite creates real invoices and credit " +
        "notes and must never run against it.",
    );
  }

  const stripeKey = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!stripeKey.startsWith("sk_test_")) {
    problems.push("STRIPE_SECRET_KEY is not an sk_test_ key. This suite creates real charges and refunds.");
  }

  if (env.NODE_ENV === "production") {
    problems.push('NODE_ENV is "production".');
  }

  const emailProvider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (requireMailpit && emailProvider !== "mailpit") {
    problems.push(
      `EMAIL_PROVIDER is "${emailProvider || "unset"}", not "mailpit". The dev database contains real ` +
        "customer addresses and these flows send cancellation and refund e-mails.",
    );
  }

  return problems;
}

/** Throws with every reason at once, so one run surfaces the whole checklist. */
export function assertSafeMoneyTestEnv(env = process.env, options = {}) {
  const problems = findUnsafeMoneyTestEnv(env, options);
  if (problems.length === 0) return;

  throw new Error(
    `Refusing to run the money e2e suite:\n\n${problems.map((p) => `  • ${p}`).join("\n")}\n\n` +
      "See tests/e2e-money/README.md.",
  );
}
