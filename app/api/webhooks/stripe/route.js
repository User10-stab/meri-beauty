import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

function toDecimal(value) {
  return Number(value ?? 0);
}

function toMinorUnitCents(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue * 100);
}

function normalizePaymentScenario(value) {
  return String(value ?? "").trim().toUpperCase();
}

function validateCheckoutSessionMetadata(session) {
  const metadata = session?.metadata ?? {};
  const appointmentId = String(metadata.appointmentId ?? "").trim();
  const paymentId = String(metadata.paymentId ?? "").trim();
  const paymentScenario = normalizePaymentScenario(metadata.paymentScenario);
  const issues = [];

  if (!appointmentId) {
    issues.push("missing appointmentId");
  }

  if (!paymentId) {
    issues.push("missing paymentId");
  }

  if (!paymentScenario || (paymentScenario !== "FULL_ONLINE" && paymentScenario !== "DEPOSIT_ONLINE")) {
    issues.push(`unsupported paymentScenario: ${paymentScenario || "<empty>"}`);
  }

  return {
    appointmentId,
    paymentId,
    paymentScenario,
    issues,
  };
}

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

async function handleCheckoutSessionCompleted(session) {
  const checkoutSessionId = session?.id || null;
  const paymentIntentId = session?.payment_intent || null;

  if (!checkoutSessionId) {
    console.warn("[Stripe Webhook] checkout.session.completed missing checkout session ID");
    return;
  }

  const metadataValidation = validateCheckoutSessionMetadata(session);
  const { appointmentId, paymentId, paymentScenario, issues } = metadataValidation;

  if (!appointmentId || !paymentId || issues.length > 0) {
    console.warn(
      `[Stripe Webhook] checkout.session.completed metadata validation failed for ${checkoutSessionId}`,
      { issues, metadata: session?.metadata ?? {} }
    );
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;

    const existingPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            staffService: {
              include: {
                staff: true,
              },
            },
          },
        },
      },
    });

    if (!existingPayment) {
      console.warn(`[Stripe Webhook] Payment not found for checkout session ${checkoutSessionId}`);
      return { processed: false, reason: "payment-not-found" };
    }

    if (existingPayment.status === "PAID" || existingPayment.status === "PARTIALLY_PAID") {
      console.info(`[Stripe Webhook] Payment ${paymentId} already processed (status=${existingPayment.status}), skipping`);
      return { processed: false, reason: "already-processed" };
    }

    const amountReceivedCents = Number(session?.amount_total ?? 0);
    const totalAmount = toDecimal(existingPayment.totalAmount);
    const depositAmount = toDecimal(existingPayment.depositAmount);
    const expectedAmountCents = paymentScenario === "FULL_ONLINE"
      ? toMinorUnitCents(totalAmount)
      : toMinorUnitCents(depositAmount);

    if (amountReceivedCents !== expectedAmountCents) {
      console.error(
        `[Stripe Webhook] Amount mismatch for checkout session ${checkoutSessionId}: expected ${expectedAmountCents} cents, received ${amountReceivedCents} cents`
      );
      return { processed: false, reason: "amount-mismatch" };
    }

    const nextPaidAmount = paymentScenario === "FULL_ONLINE" ? totalAmount : depositAmount;
    const nextRemainingAmount = Math.max(0, totalAmount - nextPaidAmount);
    const nextPaymentStatus = nextRemainingAmount > 0 ? "PARTIALLY_PAID" : "PAID";

    const appointment = existingPayment.appointment;
    const confirmationMode = appointment?.staffService?.staff?.reservationConfirmationMode ?? "MANUAL";

    // Appointment confirmation rule for AUTOMATIC mode:
    //
    // The appointment becomes CONFIRMED as soon as the customer completes
    // the required online payment — regardless of whether a remaining
    // balance is still owed at the salon.
    //
    //   FULL_ONLINE  → full amount paid now  → CONFIRMED
    //   DEPOSIT_ONLINE → deposit paid now, rest at salon → CONFIRMED
    //   MANUAL mode  → staff must approve manually → stays PENDING
    //
    // We confirm on any successful Stripe payment (PAID or PARTIALLY_PAID)
    // when the staff's confirmation mode is AUTOMATIC.
    const nextAppointmentStatus = confirmationMode === "AUTOMATIC" ? "CONFIRMED" : "PENDING";

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        paidAmount: nextPaidAmount,
        remainingAmount: nextRemainingAmount,
        status: nextPaymentStatus,
        paidAt: new Date(),
        transactionReference: checkoutSessionId,
      },
    });

    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: nextAppointmentStatus,
      },
    });

    await tx.transaction.create({
      data: {
        paymentId,
        amount: nextPaidAmount,
        method: "ONLINE",
        transactionType: paymentScenario === "FULL_ONLINE" ? "FINAL_PAYMENT" : "DEPOSIT",
        paidAt: new Date(),
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
      },
    });

    console.info(
      `[Stripe Webhook] Processed checkout session ${checkoutSessionId}`,
      {
        paymentId,
        appointmentId,
        paymentScenario,
        amountReceivedCents,
        expectedAmountCents,
        nextPaymentStatus,
        nextAppointmentStatus,
      }
    );

    return { processed: true };
  });

  if (!result?.processed) {
    if (result?.reason === "amount-mismatch") {
      return;
    }
  }
}

async function handlePaymentIntentFailed(paymentIntent) {
  const paymentIntentId = paymentIntent?.id || null;

  if (!paymentIntentId) {
    console.warn("[Stripe Webhook] payment_intent.payment_failed missing payment intent ID");
    return;
  }

  // Find the transaction by payment intent ID
  const transaction = await prisma.transaction.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
    },
    include: {
      payment: {
        include: {
          appointment: true,
        },
      },
    },
  });

  if (!transaction) {
    console.warn(`[Stripe Webhook] Transaction not found for payment intent ${paymentIntentId}`);
    return;
  }

  const payment = transaction.payment;

  // Update payment status to FAILED
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
    },
  });

  // Cancel the appointment if payment failed
  await prisma.appointment.update({
    where: { id: payment.appointmentId },
    data: {
      status: "CANCELLED",
    },
  });

  console.info(
    `[Stripe Webhook] Payment failed for payment intent ${paymentIntentId}`,
    {
      paymentId: payment.id,
      appointmentId: payment.appointmentId,
      failureReason: paymentIntent?.last_payment_error?.message || "Unknown",
    }
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
    // Direct charges fire on connected accounts and are delivered via a
    // Connect webhook endpoint. The signing secret for a Connect webhook
    // is different from the platform webhook secret. Store it in
    // STRIPE_CONNECT_WEBHOOK_SECRET in your environment variables.
    //
    // How to set this up in the Stripe Dashboard:
    //   Developers → Webhooks → Add endpoint
    //   URL: https://yourdomain.com/api/webhooks/stripe
    //   Listen to: "Events on Connected accounts"
    //   Events: checkout.session.completed, account.updated
    //
    // The signing secret shown for that endpoint is your
    // STRIPE_CONNECT_WEBHOOK_SECRET value.
    const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error(
        "[Stripe Webhook] STRIPE_CONNECT_WEBHOOK_SECRET environment variable is not set"
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
    // For Connect webhooks, event.account identifies the connected account
    // that triggered the event (e.g. the staff's Stripe account for a
    // direct charge checkout.session.completed).
    const connectedAccountId = event.account ?? null;

    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;

      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      default:
        console.log(
          `[Stripe Webhook] Unhandled event type: ${event.type}`,
          connectedAccountId ? `(account: ${connectedAccountId})` : ""
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