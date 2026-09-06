import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Stripe from "stripe";
import { RUN_METADATA_KEY, getRunId } from "./run-id.mjs";

const execFileAsync = promisify(execFile);

/**
 * Marie, refunding by hand.
 *
 * This fixture is the whole reason the suite is meaningful. The application
 * is not allowed to refund anything — the policy is that every card refund
 * is performed by an OWNER/ADMIN in the Stripe dashboard, and the
 * `charge.refunded` webhook is what teaches the ledger about it afterwards.
 *
 * So a test that refunded through an application code path would be testing
 * something that must never exist. These helpers call the Stripe API
 * directly, exactly as the dashboard does, and then the test waits for the
 * webhook to close the loop. That is the real production sequence, and it is
 * the only way to prove the webhook half actually works.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-06-30.basil" });

/** Connect direct charges (rendez-vous) live on the staff member's own account. */
function requestOptions(connectedAccountId) {
  return connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
}

/**
 * Refunds a payment the way a human would from the dashboard.
 *
 * @param {object} input
 * @param {string} input.paymentIntentId
 * @param {number} [input.amount] euros; omit to refund the full charge
 * @param {string|null} [input.connectedAccountId]
 * @returns {Promise<import("stripe").Stripe.Refund>}
 */
export async function refundInStripe({ paymentIntentId, amount = null, connectedAccountId = null }) {
  if (!paymentIntentId) throw new Error("refundInStripe: paymentIntentId is required");

  return stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amount == null ? {} : { amount: Math.round(Number(amount) * 100) }),
      // Tagged so a colleague looking at the shared test account can tell at
      // a glance that this was an automated run, not a real correction.
      metadata: { [RUN_METADATA_KEY]: getRunId() },
    },
    requestOptions(connectedAccountId),
  );
}

/** What Stripe itself believes about a charge — the source of truth we reconcile against. */
export async function readChargeFromStripe(paymentIntentId, connectedAccountId = null) {
  const intent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ["latest_charge"] },
    requestOptions(connectedAccountId),
  );
  const charge = intent.latest_charge;
  return {
    chargeId: typeof charge === "string" ? charge : charge?.id ?? null,
    amount: (intent.amount ?? 0) / 100,
    amountRefunded: (typeof charge === "object" ? charge?.amount_refunded ?? 0 : 0) / 100,
  };
}

export async function listRefundsInStripe(paymentIntentId, connectedAccountId = null) {
  const { chargeId } = await readChargeFromStripe(paymentIntentId, connectedAccountId);
  if (!chargeId) return [];
  const result = await stripe.refunds.list({ charge: chargeId, limit: 20 }, requestOptions(connectedAccountId));
  return result.data ?? [];
}

function stripeCli() {
  const localStripe = join(homedir(), ".local", "bin", "stripe");
  return process.env.STRIPE_CLI_PATH || (existsSync(localStripe) ? localStripe : "stripe");
}

function cliEnv() {
  return { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY };
}

/**
 * Redelivers the `charge.refunded` event for one specific charge, to prove
 * settlement is idempotent.
 *
 * Stripe guarantees at-least-once delivery, so a webhook arriving twice is
 * ordinary operation rather than an exotic failure — and the consequence of
 * getting it wrong is a duplicated REFUND row, a ledger that says more was
 * refunded than was ever collected, and a second "your refund is done"
 * e-mail to the customer.
 *
 * Scoped to a charge rather than taking whatever is newest. The Stripe test
 * key is shared with the rest of the team, and "the most recent
 * charge.refunded on the account" is quite likely to be somebody else's — a
 * test that resent theirs would pass while proving nothing about ours, and
 * would replay a stranger's settlement into this database on the way past.
 *
 * Uses the Stripe CLI because event redelivery is not in the REST API. Same
 * binary resolution as scripts/dev-with-stripe-webhooks.mjs.
 *
 * @param {{ chargeId: string, connectedAccountId?: string|null, searchDepth?: number }} input
 * @returns {Promise<string>} the redelivered event id
 */
export async function resendChargeRefundedEvent({ chargeId, connectedAccountId = null, searchDepth = 50 }) {
  if (!chargeId) throw new Error("resendChargeRefundedEvent: chargeId is required");

  const cli = stripeCli();
  const accountArgs = connectedAccountId ? ["--stripe-account", connectedAccountId] : [];

  const { stdout } = await execFileAsync(
    cli,
    ["events", "list", "--type", "charge.refunded", "--limit", String(searchDepth), ...accountArgs],
    { env: cliEnv() },
  );

  const events = JSON.parse(stdout)?.data ?? [];
  const mine = events.find((event) => event?.data?.object?.id === chargeId);
  if (!mine) {
    throw new Error(
      `No charge.refunded event found for charge ${chargeId} in the last ${searchDepth} events. ` +
        "Either the settlement webhook never fired, or the shared test key is busy enough that the " +
        "event has already fallen outside the search window — raise searchDepth if it is the latter.",
    );
  }

  await execFileAsync(cli, ["events", "resend", mine.id, ...accountArgs], { env: cliEnv() });
  return mine.id;
}
