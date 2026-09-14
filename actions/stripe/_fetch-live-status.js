import { stripe } from "@/lib/stripe";

/**
 * Shared live fetcher for one Connected Account (server-only).
 *
 * Fetches the account + the REAL `card_payments` capability object in
 * parallel (one Stripe round-trip batch per call — never N sequential
 * calls). `retrieveCapability` is settled leniently: on some accounts it
 * can fail while the account itself is fine, in which case callers fall
 * back to the `account.capabilities` map + account-level requirements.
 *
 * Imported only by server actions — never by client components.
 *
 * @param {string} stripeAccountId
 * @returns {Promise<{ account: object, capability: object|null }>}
 */
export async function fetchLiveStripeStatus(stripeAccountId) {
  const [accountResult, capabilityResult] = await Promise.allSettled([
    stripe.accounts.retrieve(stripeAccountId),
    stripe.accounts.retrieveCapability(stripeAccountId, "card_payments"),
  ]);

  if (accountResult.status === "rejected") {
    throw accountResult.reason;
  }

  return {
    account: accountResult.value,
    capability: capabilityResult.status === "fulfilled" ? capabilityResult.value : null,
  };
}
