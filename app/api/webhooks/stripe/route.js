import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Stripe Connect Webhook Endpoint
 *
 * Receives events from Stripe to keep the local database synchronized
 * with the state of connected accounts.
 *
 * Currently handles:
 *   - account.updated  → Updates stripeChargesEnabled, stripePayoutsEnabled
 *
 * Webhook events are idempotent — the same event can be delivered multiple
 * times and processing it will always result in the same state.
 */

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Handle stripe.account.updated event.
 *
 * Stripe sends this event whenever a connected account's status changes,
 * including after the user completes onboarding, updates their bank details,
 * or when their account capabilities change.
 */
async function handleAccountUpdated(account) {
  const { id: stripeAccountId, charges_enabled, payouts_enabled } = account;

  if (!stripeAccountId) {
    console.warn("[Stripe Webhook] account.updated event missing account ID");
    return;
  }

  // ── Find the staff member by their Stripe account ID ──────────────────
  const staff = await prisma.staff.findUnique({
    where: { stripeAccountId },
    select: { id: true },
  });

  if (!staff) {
    console.warn(
      `[Stripe Webhook] No staff found for Stripe account: ${stripeAccountId}`
    );
    return;
  }

  // ── Update the staff record with the latest account status ────────────
  //
  // The account.updated event fires when:
  //   • Onboarding is completed (details_submitted becomes true)
  //   • Charges are enabled/disabled (charges_enabled changes)
  //   • Payouts are enabled/disabled (payouts_enabled changes)
  //   • Requirements become due or are satisfie

  await prisma.staff.update({
    where: { id: staff.id },
    data: {
      stripeChargesEnabled: charges_enabled ?? false,
      stripePayoutsEnabled: payouts_enabled ?? false,
    },
  });

  console.log(
    `[Stripe Webhook] Updated staff ${staff.id}: ` +
    `charges_enabled=${charges_enabled}, payouts_enabled=${payouts_enabled}`
  );
}

// ─── POST /api/webhooks/stripe ──────────────────────────────────────────────

export async function POST(request) {
  try {
    // ── 1. Read the raw request body (must be text, not JSON) ────────────
    const body = await request.text();

    // ── 2. Get the Stripe signature from headers ─────────────────────────
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      console.error("[Stripe Webhook] Missing stripe-signature header");
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    // ── 3. Verify the webhook secret is configured ───────────────────────
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error(
        "[Stripe Webhook] STRIPE_WEBHOOK_SECRET environment variable is not set"
      );
      return new Response("Webhook secret not configured", { status: 500 });
    }

    // ── 4. Verify the webhook signature ──────────────────────────────────
    // This ensures the request actually came from Stripe and hasn't been
    // tampered with. Constructs the event object from the raw body and
    // signature using the webhook signing secret.
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error(
        "[Stripe Webhook] Signature verification failed:",
        err.message
      );
      return new Response(`Webhook signature verification failed: ${err.message}`, {
        status: 400,
      });
    }

    // ── 5. Route the event to the appropriate handler ────────────────────
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;

      default:
        // Log unhandled event types for debugging — Stripe sends many
        // event types (payment_intent.*, charge.*, etc.) that we don't
        // need to handle for this integration.
        console.log(
          `[Stripe Webhook] Unhandled event type: ${event.type}`
        );
    }

    // ── 6. Acknowledge receipt ───────────────────────────────────────────
    // Stripe expects a 200 response to confirm the event was received.
    // If we return a non-200 status, Stripe will retry the delivery.
    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Stripe Webhook] Unexpected error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}