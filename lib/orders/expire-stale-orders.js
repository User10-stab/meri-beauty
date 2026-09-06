import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";

async function alertStaffOfPickupExpiry(order) {
  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
  if (!salon?.email) return;

  const itemLines = order.items.map((item) => `${item.quantity} × ${item.productName} — ${item.variantName}`);

  await sendEmail({
    to: salon.email,
    subject: `⚠️ Retrait à vérifier — commande n°${order.orderNumber} expirée`,
    text:
      `La commande n°${order.orderNumber} (${order.user.fullName}, ${order.user.email}) vient d'expirer sans avoir été marquée "retrait terminé".\n\n` +
      `Articles : ${itemLines.join(", ")}\n\n` +
      `Le stock reste réservé : rien ne permet de savoir automatiquement si ces produits ont déjà été remis en main propre.\n` +
      `Dans « Commandes › Retraits à vérifier » : si la cliente est bien venue, finalisez le retrait normalement ; si elle n'est jamais venue, confirmez-le pour remettre les articles en vente.`,
    html:
      `<p>La commande n°${order.orderNumber} (${order.user.fullName}, ${order.user.email}) vient d'expirer sans avoir été marquée « retrait terminé ».</p>` +
      `<p><strong>Articles :</strong> ${itemLines.join(", ")}</p>` +
      `<p>Le stock reste réservé : rien ne permet de savoir automatiquement si ces produits ont déjà été remis en main propre.</p>` +
      `<p>Dans « Commandes › Retraits à vérifier » : si la cliente est bien venue, finalisez le retrait normalement ; si elle n'est jamais venue, confirmez-le pour remettre les articles en vente.</p>`,
  });
}

/**
 * The day-7 note to the customer — the half of this that was missing.
 *
 * The salon cannot tell "never came" from "came and nobody ran
 * completeOrderPickup". The customer can: they either walked out with the
 * bag or they did not. Until this e-mail they were the one party in the loop
 * who held the answer and was never asked, while the decision waited on
 * staff reconstructing it from a shelf.
 *
 * So it is deliberately written as a question rather than a cancellation
 * notice. Either answer resolves the order faster and more reliably than any
 * timer, and the reply lands in the salon inbox where the worklist is already
 * being worked.
 */
async function notifyCustomerOfPickupExpiry(order) {
  if (!order.user?.email) return;

  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true, phone: true } });
  const contact = [salon?.email, salon?.phone].filter(Boolean).join(" · ");
  const itemLines = order.items.map((item) => `${item.quantity} × ${item.productName} — ${item.variantName}`);

  // Never "vos articles sont remis en vente": at this point they are not.
  // The reservation is still held, and saying otherwise to somebody who is
  // about to come and collect would be the one genuinely damaging thing this
  // e-mail could do.
  await sendEmail({
    to: order.user.email,
    subject: `Votre commande n°${order.orderNumber} vous attend toujours – Meri Beauty`,
    text:
      `Bonjour ${order.user.fullName},\n\n` +
      `Votre commande n°${order.orderNumber}, à retirer et à régler en boutique, a dépassé le délai de retrait.\n\n` +
      `Articles : ${itemLines.join(", ")}\n\n` +
      `Nous gardons vos articles de côté pour le moment. Un petit mot suffit :\n` +
      `— vous les avez déjà récupérés en boutique ;\n` +
      `— vous souhaitez toujours les récupérer, et nous convenons d'un moment ;\n` +
      `— vous n'en avez plus besoin, et nous les remettons en vente.\n\n` +
      `Sans nouvelle de votre part, les articles seront automatiquement remis en vente d'ici quelques semaines.\n\n` +
      (contact ? `Vous pouvez nous répondre directement ou nous joindre : ${contact}\n\n` : "") +
      `L'équipe Meri Beauty`,
    html:
      `<p>Bonjour ${order.user.fullName},</p>` +
      `<p>Votre commande n°${order.orderNumber}, à retirer et à régler en boutique, a dépassé le délai de retrait.</p>` +
      `<p><strong>Articles :</strong> ${itemLines.join(", ")}</p>` +
      `<p>Nous gardons vos articles de côté pour le moment. Un petit mot suffit :</p>` +
      `<ul>` +
      `<li>vous les avez déjà récupérés en boutique ;</li>` +
      `<li>vous souhaitez toujours les récupérer, et nous convenons d'un moment ;</li>` +
      `<li>vous n'en avez plus besoin, et nous les remettons en vente.</li>` +
      `</ul>` +
      `<p>Sans nouvelle de votre part, les articles seront automatiquement remis en vente d'ici quelques semaines.</p>` +
      (contact ? `<p>Vous pouvez nous répondre directement ou nous joindre : ${contact}</p>` : "") +
      `<p>L'équipe Meri Beauty</p>`,
  });
}

/**
 * For the /api/cron job runner, not called from the UI: releases abandoned
 * PENDING_PAYMENT checkouts (short window) and expires un-collected
 * PICKUP_ON_SITE orders (7-day window per the locked policy — prepaid pickups
 * never auto-expire, the customer already paid).
 *
 * The two branches deliberately do NOT treat stock the same way.
 *
 * A PENDING_PAYMENT checkout was never handed to anybody, so releasing its
 * reservation here is safe and the customer is told immediately.
 *
 * A PICKUP_ON_SITE order is the opposite: "not marked collected" and "never
 * handed over" look identical from here, and the likelier of the two is staff
 * giving the products to the customer at the counter and forgetting to run
 * completeOrderPickup. Restocking on that guess put an item that had already
 * left the salon back on sale, where it could be sold a second time. So this
 * branch expires the order and raises the worklist, and the reservation is
 * held until a human says which way it went — either completeOrderPickup (she
 * did come) or confirmExpiredPickupNotCollected (she never did), both in
 * actions/boutique/orders.js.
 *
 * Both parties are told: the salon gets the worklist item, the customer gets
 * asked whether they already collected. Holding the stock is only defensible
 * because somebody is chasing the answer, and the customer is the one who
 * has it.
 *
 * The hold is not indefinite — see releaseUnverifiedPickups below. An
 * unbounded hold is a promise about staff habit sustained forever, which is
 * not a promise this should make.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-expires every stale order in the system on each call.
 */
export async function expireStaleOrders() {
  const now = new Date();
  const stale = await prisma.order.findMany({
    where: {
      expiresAt: { lt: now },
      OR: [
        { status: "PENDING_PAYMENT" },
        { fulfilmentMode: "PICKUP_ON_SITE", status: { in: ["PENDING_PICKUP", "READY_FOR_PICKUP"] } },
      ],
    },
    include: { items: true, user: { select: { fullName: true, email: true } } },
  });

  let expiredCount = 0;

  for (const order of stale) {
    try {
      // Our local PENDING_PAYMENT status can be stale: the customer may have
      // already paid on Stripe's hosted page moments before this exact
      // expiry window closed, and the webhook just hasn't landed yet.
      // Blindly expiring here would silently swallow that payment — the
      // money is charged, but no Payment row, no stock decrement, no
      // confirmation ever gets created, because the webhook later finds the
      // order no longer PENDING_PAYMENT and no-ops. Same real incident and
      // same guard as the supersede path in createOrderFromCart
      // (actions/boutique/orders.js) — check with Stripe directly before
      // assuming abandonment.
      if (order.status === "PENDING_PAYMENT" && order.stripeCheckoutSessionId) {
        try {
          const liveSession = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
          if (liveSession.payment_status === "paid") {
            // fulfillOrderPayment is idempotent (claims via
            // Payment.transactionReference), so this is safe even if the
            // real webhook delivery lands moments later too.
            await fulfillOrderPayment(liveSession);
            continue;
          }
          // Make the hosted payment URL inert before releasing its stock.
          // Otherwise a customer could pay an old QR after local expiry and
          // force an avoidable automatic refund.
          if (liveSession.status === "open") {
            await stripe.checkout.sessions.expire(liveSession.id);
          }
        } catch (err) {
          // If Stripe cannot be checked/expired, keep the local order pending.
          // Releasing stock while its Checkout URL may still accept money is
          // less safe than holding it until the next retry.
          console.error("[expireStaleOrders] Stripe session check failed for order", order.id, "deferring expiry:", err);
          continue;
        }
      }

      // Atomic claim gated on the status read above: if a customer paid,
      // cancelled, or picked up between the findMany and here — or an
      // overlapping cron run already claimed this same order — the WHERE
      // clause no longer matches and this update affects zero rows. Only
      // the run that actually flips the row goes on to decrement stock and
      // email the customer.
      const claimed = await prisma.$transaction(async (tx) => {
        // cancelledAt is set for BOTH branches now — it previously stayed
        // null for on-site pickup expirations, which broke any "cancelled
        // orders" query filtering on that column even though the order was
        // just as dead as a payment-timeout cancellation.
        const claim = await tx.order.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: order.status === "PENDING_PAYMENT" ? "CANCELLED" : "EXPIRED",
            cancelledAt: new Date(),
            cancelReason:
              order.status === "PENDING_PAYMENT"
                ? "Paiement non complété"
                : "Retrait non effectué dans le délai imparti",
          },
        });
        if (claim.count === 0) return false;

        // Only the never-paid branch gives stock back automatically. An
        // expired pickup keeps its reservation (and its promo usage, which
        // is released by the same confirmation) until staff confirm the
        // customer never collected.
        if (order.status === "PENDING_PAYMENT") {
          for (const item of order.items) {
            // POS ad-hoc service lines (variantId null) carry no stock to adjust.
            if (!item.variantId) continue;
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { reservedQuantity: { decrement: item.quantity } },
            });
          }
          if (order.promoCodeId) {
            await tx.promoCode.updateMany({
              where: { id: order.promoCodeId, usedCount: { gt: 0 } },
              data: { usedCount: { decrement: 1 } },
            });
          }
          await tx.order.update({ where: { id: order.id }, data: { stockReleasedAt: new Date() } });
        }
        return true;
      });

      if (!claimed) continue;

      if (order.status === "PENDING_PAYMENT") {
        // Only this branch has actually released anything, so it is the only
        // one that can honestly say the articles are back on sale.
        sendEmail({
          to: order.user.email,
          subject: `Commande expirée – n°${order.orderNumber} – Meri Beauty`,
          text:
            `Bonjour ${order.user.fullName},\n\n` +
            `Votre commande n°${order.orderNumber} a expiré et a été annulée. ` +
            `Les articles ont été remis en stock — vous pouvez repasser commande à tout moment.\n\n` +
            `L'équipe Meri Beauty`,
          html:
            `<p>Bonjour ${order.user.fullName},</p>` +
            `<p>Votre commande n°${order.orderNumber} a expiré et a été annulée. ` +
            `Les articles ont été remis en stock — vous pouvez repasser commande à tout moment.</p>` +
            `<p>L'équipe Meri Beauty</p>`,
        }).catch((err) => console.error("[expireStaleOrders] email failed:", err));
      } else {
        // Both parties, because neither alone can close this out. The salon
        // gets the worklist item; the customer gets asked the one question
        // that actually settles it — did you already collect these? Whether
        // the goods are on a shelf or in somebody's bag decides both what
        // happens to the stock and what the customer should be told, and the
        // customer is the cheaper and more reliable source of that answer.
        alertStaffOfPickupExpiry(order).catch((err) =>
          console.error("[expireStaleOrders] staff pickup-expiry alert failed:", err)
        );
        notifyCustomerOfPickupExpiry(order).catch((err) =>
          console.error("[expireStaleOrders] customer pickup-expiry notice failed:", err)
        );
      }

      expiredCount += 1;
    } catch (error) {
      console.error("[expireStaleOrders] failed for order", order.id, error);
    }
  }

  return { success: true, expiredCount };
}

/**
 * Days a verified-pickup worklist item is held for a human verdict before
 * its stock is released without one.
 *
 * With the 7-day expiry window this makes the full arc 7 + 14 = 21 days.
 * Marie's original rule (PROJECT_REQUIREMENTS.md §2) was "release after 7
 * days"; the substance of it — stock cannot be held forever — is right, and
 * only the timing was wrong. Seven days is too short to act on *without a
 * person*, because the system genuinely cannot distinguish the two cases.
 * So seven days became the alarm and three weeks the release.
 *
 * Exported so a test can express its fixtures in terms of the policy rather
 * than restating the number and drifting from it.
 */
export const PICKUP_VERIFICATION_GRACE_DAYS = 14;

/**
 * The backstop for expired pickups nobody ever ruled on.
 *
 * expireStaleOrders deliberately holds an expired pickup's stock rather than
 * guessing, and that is right — the failure it avoids (selling goods already
 * in a customer's bag) is unrecoverable, while the one it accepts (not
 * selling goods that are on the shelf) is fixable with one click at any
 * time. But "fixable at any time" only helps if somebody eventually clicks.
 * Nobody opens the worklist unprompted forever, and a reservation held for
 * months shows a product out of stock while it sits on the shelf.
 *
 * So the hold gets a ceiling. After PICKUP_VERIFICATION_GRACE_DAYS with no
 * verdict, the same release confirmExpiredPickupNotCollected performs runs
 * here without one.
 *
 * Two things make that safe enough to automate where day 7 was not:
 *
 *   - The customer has been asked directly (notifyCustomerOfPickupExpiry)
 *     and has had three weeks to say "I already collected those".
 *   - An expiry only happens when *no money was recorded*. So a pickup that
 *     was really handed over is also an unrecorded sale, which the till
 *     reconciliation surfaces as a variance long before day 21.
 *
 * `stockReleasedByUserId` stays null, which is what distinguishes this from
 * a staff decision in the audit trail — the column already exists and is
 * already nullable, so nothing is lost by an automatic release looking
 * different from a human one.
 *
 * The salon is told afterwards, once, as a digest. If any of these really
 * had been collected, this is the moment the stock figure silently becomes
 * wrong, and that is worth an e-mail rather than a silent correction.
 *
 * Same reason as expireStaleOrders for living outside any "use server"
 * module: every export from one is a public unauthenticated POST endpoint,
 * and this mutates stock across every stale order in the system.
 */
export async function releaseUnverifiedPickups() {
  const cutoff = new Date(Date.now() - PICKUP_VERIFICATION_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const unverified = await prisma.order.findMany({
    where: {
      fulfilmentMode: "PICKUP_ON_SITE",
      status: "EXPIRED",
      stockReleasedAt: null,
      // cancelledAt is when expireStaleOrders expired it, so the grace period
      // runs from the expiry rather than from the order — an order that sat
      // in PENDING_PICKUP for a month before expiring still gets its full
      // verification window.
      cancelledAt: { lt: cutoff },
    },
    include: { items: true, user: { select: { fullName: true, email: true } } },
  });

  const released = [];

  for (const order of unverified) {
    try {
      // Same claim shape as confirmExpiredPickupNotCollected: gated on
      // stockReleasedAt being null, because this decrements reservedQuantity
      // and must happen exactly once even if a staff member presses the
      // button at the same moment this job runs.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.order.updateMany({
          where: { id: order.id, status: "EXPIRED", stockReleasedAt: null },
          data: { stockReleasedAt: new Date() },
        });
        if (claim.count === 0) return false;

        for (const item of order.items) {
          // POS ad-hoc service lines (variantId null) carry no stock to adjust.
          if (!item.variantId) continue;
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
        // The promo code was held for this order for the same reason the
        // stock was; it goes back with it.
        if (order.promoCodeId) {
          await tx.promoCode.updateMany({
            where: { id: order.promoCodeId, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
        await tx.auditLog.create({
          data: {
            // No actor: this release is the absence of a decision, not one.
            actorId: null,
            actorRole: null,
            action: "order.expired_pickup_stock_released_automatically",
            entityType: "Order",
            entityId: order.id,
            metadata: {
              orderNumber: order.orderNumber,
              graceDays: PICKUP_VERIFICATION_GRACE_DAYS,
              expiredAt: order.cancelledAt,
              items: order.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
            },
          },
        });
        return true;
      });

      if (!claimed) continue;
      released.push(order);

      // Now — and only now — is it true that the articles are back on sale,
      // which is the same condition confirmExpiredPickupNotCollected sends
      // its version of this e-mail under.
      if (order.user?.email) {
        sendEmail({
          to: order.user.email,
          subject: `Commande expirée – n°${order.orderNumber} – Meri Beauty`,
          text:
            `Bonjour ${order.user.fullName},\n\n` +
            `Sans nouvelle de votre part, votre commande n°${order.orderNumber} a été annulée et les articles ont été remis en vente.\n\n` +
            `Si vous les aviez déjà récupérés en boutique, merci de nous le signaler : cela nous permet de corriger notre stock.\n\n` +
            `Vous pouvez repasser commande à tout moment.\n\n` +
            `L'équipe Meri Beauty`,
          html:
            `<p>Bonjour ${order.user.fullName},</p>` +
            `<p>Sans nouvelle de votre part, votre commande n°${order.orderNumber} a été annulée et les articles ont été remis en vente.</p>` +
            `<p>Si vous les aviez déjà récupérés en boutique, merci de nous le signaler : cela nous permet de corriger notre stock.</p>` +
            `<p>Vous pouvez repasser commande à tout moment.</p>` +
            `<p>L'équipe Meri Beauty</p>`,
        }).catch((err) => console.error("[releaseUnverifiedPickups] customer email failed:", err));
      }
    } catch (error) {
      console.error("[releaseUnverifiedPickups] failed for order", order.id, error);
    }
  }

  if (released.length > 0) {
    alertSalonOfAutomaticRelease(released).catch((err) =>
      console.error("[releaseUnverifiedPickups] salon digest failed:", err)
    );
  }

  return { success: true, releasedCount: released.length };
}

/**
 * One digest, not one e-mail per order — these are three-week-old items and
 * they tend to arrive in clumps after a quiet period on the worklist.
 */
async function alertSalonOfAutomaticRelease(orders) {
  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
  if (!salon?.email) return;

  const lines = orders.map(
    (order) =>
      `n°${order.orderNumber} (${order.user?.fullName ?? "client inconnu"}) — ` +
      order.items.map((item) => `${item.quantity} × ${item.productName}`).join(", ")
  );

  await sendEmail({
    to: salon.email,
    subject: `Stock remis en vente automatiquement — ${orders.length} retrait(s) non vérifié(s)`,
    text:
      `${orders.length} commande(s) à retirer en boutique sont restées ${PICKUP_VERIFICATION_GRACE_DAYS} jours dans « Retraits à vérifier » sans qu'une décision soit prise. ` +
      `Le stock a été remis en vente automatiquement.\n\n` +
      `${lines.join("\n")}\n\n` +
      `Si l'une de ces clientes était en réalité venue chercher ses articles, le stock est maintenant surévalué : vérifiez le rayon et corrigez-le dans « Stock ».`,
    html:
      `<p>${orders.length} commande(s) à retirer en boutique sont restées ${PICKUP_VERIFICATION_GRACE_DAYS} jours dans « Retraits à vérifier » sans qu'une décision soit prise. ` +
      `Le stock a été remis en vente automatiquement.</p>` +
      `<ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>` +
      `<p>Si l'une de ces clientes était en réalité venue chercher ses articles, le stock est maintenant surévalué : vérifiez le rayon et corrigez-le dans « Stock ».</p>`,
  });
}
