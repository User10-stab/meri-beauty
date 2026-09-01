import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { qrPngAttachment } from "@/lib/qrcode";
import { issueInvoice, buildInvoiceCustomer } from "@/lib/invoicing";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { hasInvoiceableVatIdentity } from "@/lib/tax-policy";
import { captureCriticalError, captureWarning } from "@/lib/monitoring";
import {
  createNotificationsBulk,
  buildOrderPaidNotification,
  getSalonAdminNotificationRecipients,
} from "@/lib/notifications";

async function createAutomaticOrderRefund(session, orderId, reason) {
  if (!session.payment_intent) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;

  await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      metadata: {
        kind: "order_auto_refund",
        orderId,
        reason,
        checkoutSessionId: session.id,
      },
    },
    { idempotencyKey: `order-auto-refund:${reason}:${session.id}` }
  );
}

/**
 * Order items (+ shipping, + a promo discount line if any) as invoice line
 * snapshots. Product lines keep their full face-value unit price for
 * clarity — the discount is shown as its own negative line — rather than
 * silently reducing each product's displayed price, per bigbatch.txt P0
 * "Les promotions rendent les retours partiels incorrects" (which also
 * flagged this exact invoice mismatch: lines summed to the pre-discount
 * total while the invoice's totalInclVat was the post-discount amount
 * actually paid).
 */
export function orderInvoiceLines(order) {
  const lines = order.items.map((item) => ({
    description: `${item.productName} — ${item.variantName}`,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
  }));
  if (Number(order.shippingCost) > 0) {
    lines.push({ description: "Livraison", quantity: 1, unitPrice: Number(order.shippingCost) });
  }
  if (Number(order.discountAmount) > 0) {
    lines.push({ description: "Code promotionnel", quantity: 1, unitPrice: -Number(order.discountAmount) });
  }

  const linesTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const expected = Number(order.totalAmount);
  if (Math.abs(linesTotal - expected) > 0.01) {
    captureWarning("Invoice line total does not match order.totalAmount", {
      area: "invoicing",
      orderId: order.id,
      linesTotal,
      expected,
    });
  }

  return lines;
}

/**
 * Called by the Stripe webhook (app/api/webhooks/stripe/route.js) when
 * session.metadata.kind === "order". Idempotent via
 * Payment.transactionReference, same pattern as the appointment path.
 *
 * Deliberately kept out of any "use server" module. Every Next.js export
 * from a "use server" file is a public, unauthenticated POST endpoint —
 * this function trusts `session.amount_total` / `session.payment_intent`
 * completely, which is only safe because its one legitimate caller
 * (the webhook route) has already verified the Stripe signature on the
 * raw event before calling it. A client-reachable version of this
 * function is a free-merchandise exploit: fabricate a session object,
 * mark any pending order PAID, decrement stock, get an invoice, pay
 * nothing.
 */
export async function fulfillOrderPayment(session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) return { received: true, warning: "missing orderId metadata" };

  const existing = await prisma.payment.findFirst({
    where: { transactionReference: session.id },
    select: { id: true },
  });
  if (existing) return { received: true, alreadyProcessed: true };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      cart: { select: { id: true, status: true } },
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          vatNumber: true,
          vatValidatedAt: true,
          vatValidationName: true,
          addressLine1: true,
          addressLine2: true,
          addressCity: true,
          addressPostalCode: true,
          addressCountry: true,
          isCompany: true,
          billingProfile: {
            select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
          },
        },
      },
    },
  });

  if (!order || order.status === "CANCELLED" || order.status === "EXPIRED") {
    console.warn("[fulfillOrderPayment] order gone/cancelled after payment, refunding:", session.id);
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "order-unavailable").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order unavailable" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "order unavailable" };
  }

  if (order.status !== "PENDING_PAYMENT") {
    // The `existing` check above already handled a retried delivery of the
    // *same* session (harmless, Stripe's at-least-once guarantee). Reaching
    // here means a *different* session — a stale tab, a retry button, a
    // resumed checkout — settled after the order was already paid through
    // another one. That's a real second charge Stripe actually captured;
    // refund it rather than silently leaving the customer out that money.
    console.warn(`[fulfillOrderPayment] order ${orderId} already ${order.status}, refunding stray session:`, session.id);
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "order-already-paid").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order already paid" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "order already paid" };
  }

  const paidAmount = (session.amount_total ?? 0) / 100;
  const isPointOfSale = order.source === "POS";
  const nextStatus = isPointOfSale
    ? "COMPLETED"
    : order.fulfilmentMode === "SHIPPING_PREPAID"
      ? "PROCESSING"
      : "PAID";

  // Paranoid check: line items are built server-side, but the webhook is the
  // last line of defense on money.
  const expectedAmount = Number(order.totalAmount);
  const paidAmountCents = Number(session.amount_total ?? 0);
  const expectedAmountCents = Math.round(expectedAmount * 100);
  if (paidAmountCents < expectedAmountCents) {
    captureCriticalError(new Error("Order payment underpayment detected"), {
      area: "refund-reconciliation",
      sessionId: session.id,
      orderId,
      paidAmount,
      expectedAmount,
    });
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "underpayment").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "underpayment" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "underpayment" };
  }
  if (paidAmountCents > expectedAmountCents) {
    captureCriticalError(new Error("Order payment overpayment detected"), {
      area: "refund-reconciliation",
      sessionId: session.id,
      orderId,
      paidAmount,
      expectedAmount,
    });
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "overpayment").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "overpayment" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "overpayment" };
  }

  let invoice;
  try {
  ({ invoice } = await prisma.$transaction(async (tx) => {
    // Atomic claim, gated on the order still being PENDING_PAYMENT — the read
    // above is only a fast-path check. Without this, a customer cancellation
    // (cancelMyOrder, gated on the same statuses) landing at the same instant
    // as this webhook delivery could have its CANCELLED write silently
    // overwritten back to PAID by the order.update further below committing
    // after it. Claiming it now, up front, means everything else in this
    // transaction (payment, stock, invoice) only happens for the winner.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT" },
      data: {
        status: nextStatus,
        expiresAt: null,
        ...(isPointOfSale
          ? { pickedUpAt: new Date(), pickedUpByStaffId: order.createdByStaffId }
          : {}),
      },
    });
    if (claim.count === 0) throw new Error("ORDER_NO_LONGER_PENDING");

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        totalAmount: order.totalAmount,
        paidAmount,
        remainingAmount: 0,
        paymentType: "ONLINE",
        status: "PAID",
        paidAt: new Date(),
        transactionReference: session.id,
        promoCodeId: order.promoCodeId,
        discountAmount: order.discountAmount,
      },
    });

    await tx.transaction.create({
      data: {
        paymentId: payment.id,
        amount: paidAmount,
        method: "ONLINE",
        transactionType: "FINAL_PAYMENT",
        paidAt: new Date(),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      },
    });

    const invoiceCustomerUser = order.customerVatNumber
      ? { ...order.user, vatNumber: order.customerVatNumber }
      : order.user;
    // Same rule everywhere, online store and POS QR checkout alike: a
    // particulier never gets an invoice, only a VIES-valid VAT identity
    // does. `!isPointOfSale ||` used to make this always true for every
    // online order regardless of VAT status — fixed.
    const shouldCreateInvoice = hasInvoiceableVatIdentity(invoiceCustomerUser);
    const invoice = shouldCreateInvoice
      ? await issueInvoice(tx, {
          paymentId: payment.id,
          source: "ORDER",
          totalInclVat: paidAmount,
          customer: buildInvoiceCustomer(invoiceCustomerUser),
          lines: orderInvoiceLines(order),
          vatRate: Number(order.vatRate),
          vatTreatment: order.vatTreatment,
          taxCountryCode: order.taxCountryCode,
          taxNote: order.taxNote,
        })
      : null;

    for (const item of order.items) {
      // POS ad-hoc service lines (variantId null) carry no stock to adjust.
      if (!item.variantId) continue;
      // Atomic {decrement} on both columns — a plain read-then-write of a
      // JS-computed literal would let two orders paying for the same
      // variant at once silently lose one side's decrement.
      const updated = await tx.productVariant.update({
        where: { id: item.variantId },
        data: {
          stockQuantity: { decrement: item.quantity },
          reservedQuantity: { decrement: item.quantity },
        },
      });
      const newStock = updated.stockQuantity;

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "SALE",
          quantity: -item.quantity,
          previousStock: newStock + item.quantity,
          newStock,
          reason: `Commande n°${order.orderNumber}`,
          createdById: isPointOfSale ? order.createdByStaffId : null,
        },
      });
    }

    // Only now — payment confirmed — does the source cart actually empty. It was
    // deliberately left ACTIVE at checkout time so an abandoned Stripe session
    // wouldn't wipe the customer's cart (see createOrderFromCart).
    if (order.cart && order.cart.status === "ACTIVE") {
      await tx.cart.update({ where: { id: order.cart.id }, data: { status: "CONVERTED" } });
    }

    await tx.notification.create({
      data: {
        userId: order.user.id,
        type: "PAYMENT_RECEIVED",
        title: "Paiement reçu",
        message: `Paiement de €${paidAmount.toFixed(2)} reçu pour la commande n°${order.orderNumber}.`,
        status: "PENDING",
      },
    });

    // Salon side. Skipped for a counter sale: the staff member rang it up and
    // is standing at the till, so notifying every admin is pure noise — the
    // audit log above is the record for those.
    if (!isPointOfSale) {
      const adminIds = await getSalonAdminNotificationRecipients({ tx });
      if (adminIds.length > 0) {
        await createNotificationsBulk(
          adminIds.map((userId) =>
            buildOrderPaidNotification({
              userId,
              orderId: order.id,
              orderNumber: order.orderNumber,
              customerName: order.user.fullName,
              totalAmount: paidAmount,
              fulfilmentMode: order.fulfilmentMode,
            })
          ),
          { tx }
        );
      }
    }

    if (isPointOfSale) {
      await tx.auditLog.create({
        data: {
          actorId: order.createdByStaffId,
          action: "order.point_of_sale_qr_paid",
          entityType: "Order",
          entityId: order.id,
          before: { status: "PENDING_PAYMENT" },
          after: { status: "COMPLETED", totalAmount: paidAmount, stripeSessionId: session.id },
        },
      });
    }

    return { invoice };
  // This transaction's sequential round trips (order claim, payment,
  // transaction row, invoice numbering, stock updates) were measured
  // reproducibly exceeding Prisma's 5000ms default interactive-transaction
  // timeout against Neon (P2028) — a real payment webhook silently failed to
  // fulfil because of it. 20s/10s gives real headroom without masking a
  // genuinely stuck transaction.
  }, { timeout: 20000, maxWait: 10000 }));
  } catch (err) {
    // The Payment.transactionReference unique constraint is the real
    // idempotency guarantee — the findFirst check above is just a fast path
    // that two near-simultaneous webhook deliveries can both pass before
    // either commits. A P2002 here means the other delivery won the race;
    // this one is done, not failed.
    if (err.code === "P2002") {
      return { received: true, alreadyProcessed: true };
    }
    // A zero-row claim is ambiguous: a cancellation may have won, but a
    // duplicate webhook/action can also have completed this exact session
    // while this invocation was waiting for the order row lock. Re-check the
    // durable Payment before deciding. Otherwise, the losing duplicate can
    // refund the winning invocation's successfully finalized payment.
    if (err.message === "ORDER_NO_LONGER_PENDING") {
      const processedPayment = await prisma.payment.findFirst({
        where: { orderId, transactionReference: session.id },
        select: { id: true },
      });
      if (processedPayment) {
        return { received: true, alreadyProcessed: true };
      }

      const latestOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (latestOrder && latestOrder.status !== "CANCELLED" && latestOrder.status !== "EXPIRED") {
        captureCriticalError(new Error("Order payment claim lost without a completed payment or cancellation"), {
          area: "stripe-webhook",
          sessionId: session.id,
          orderId,
          orderStatus: latestOrder.status,
        });
        throw err;
      }

      console.warn("[fulfillOrderPayment] order cancelled during payment, refunding:", session.id);
      if (session.payment_intent) {
        await createAutomaticOrderRefund(session, orderId, "order-cancelled-during-payment").catch((refundErr) => {
          captureCriticalError(refundErr, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order cancelled during payment" });
          throw refundErr;
        });
      }
      return { received: true, refunded: true, reason: "order cancelled during payment" };
    }
    throw err;
  }

  if (isPointOfSale) {
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
    });
    const ticketPdf = await renderTicketPdf({
      orderNumber: order.orderNumber,
      issuedAt: order.createdAt,
      sellerName: salon?.legalName || "Meri Beauty",
      sellerAddress: formatSalonAddress(salon),
      sellerVatNumber: salon?.vatNumber ?? null,
      subtotalExclVat: order.totalExclVat,
      vatRate: order.vatRate,
      vatAmount: order.totalVat,
      totalInclVat: order.totalAmount,
      lines: order.items.map((item) => ({ description: item.productName, quantity: item.quantity, unitPrice: Number(item.unitPrice) })),
    }).catch((err) => {
      console.error("[fulfillOrderPayment] POS ticket PDF render failed:", err);
      return null;
    });
    const pendingInvoiceNote = !invoice
      ? ""
      : order.customerVatNumber?.toUpperCase().startsWith("BE")
      ? ` La facture officielle n°${invoice.number} sera transmise séparément via Billit/Peppol depuis Opérations.`
      : ` La facture officielle n°${invoice.number} sera envoyée séparément depuis Opérations.`;

    sendEmail({
      to: order.user.email,
      subject: `Votre ticket — Commande n°${order.orderNumber} — Meri Beauty`,
      text:
        `Bonjour ${order.user.fullName},\n\n` +
        `Votre paiement de €${paidAmount.toFixed(2)} pour la commande n°${order.orderNumber} a bien été reçu. Votre ticket est joint à cet e-mail.${pendingInvoiceNote}\n\n` +
        `L'équipe Meri Beauty`,
      ...(ticketPdf ? { attachments: [{ filename: `ticket-${order.orderNumber}.pdf`, content: ticketPdf }] } : {}),
      html:
        `<p>Bonjour ${order.user.fullName},</p>` +
        `<p>Votre paiement de <strong>€${paidAmount.toFixed(2)}</strong> pour la commande n°${order.orderNumber} a bien été reçu. Votre ticket est joint à cet e-mail.</p>` +
        (pendingInvoiceNote ? `<p>${pendingInvoiceNote.trim()}</p>` : "") +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[fulfillOrderPayment] POS ticket email failed:", err));

    return { received: true, processed: true };
  }

  const pickupNote = order.fulfilmentMode === "PICKUP_PREPAID"
      ? `Nous vous préviendrons dès qu'elle sera prête à être retirée. Code de retrait : ${order.pickupCode}.`
      : "Elle sera expédiée sous peu vers votre point relais Mondial Relay — vous recevrez le numéro de suivi par e-mail.";

  // The invoice PDF is never auto-e-mailed here either, even for a
  // VIES-valid customer whose invoice was created above — only a ticket
  // goes out automatically. Marie sends the real invoice manually from
  // Opérations (Peppol for a Belgian VAT number, e-mail otherwise). Mirrors
  // the isPointOfSale branch above and settleReservation's own split.
  const salon = await prisma.salon.findUnique({
    where: { id: "main-salon" },
    select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
  });
  const ticketPdf = await renderTicketPdf({
    orderNumber: order.orderNumber,
    issuedAt: order.createdAt,
    sellerName: salon?.legalName || "Meri Beauty",
    sellerAddress: formatSalonAddress(salon),
    sellerVatNumber: salon?.vatNumber ?? null,
    subtotalExclVat: order.totalExclVat,
    vatRate: order.vatRate,
    vatAmount: order.totalVat,
    totalInclVat: order.totalAmount,
    lines: order.items.map((item) => ({ description: item.productName, quantity: item.quantity, unitPrice: Number(item.unitPrice) })),
  }).catch((err) => {
    console.error("[fulfillOrderPayment] ticket PDF render failed:", err);
    return null;
  });
  const pendingInvoiceNote = !invoice
    ? ""
    : order.customerVatNumber?.toUpperCase().startsWith("BE")
    ? ` La facture officielle n°${invoice.number} vous sera transmise séparément via Billit/Peppol depuis Opérations.`
    : ` La facture officielle n°${invoice.number} vous sera envoyée séparément depuis Opérations.`;

  // A prepaid pickup is the one case where the customer has to prove, at the
  // counter, that this order is theirs. Send the QR with the confirmation
  // instead of leaving it in "Mon compte" — a page most customers never open.
  // POS sales are already standing at the till, and a shipped order has no
  // counter to present anything at.
  const pickupQr =
    !isPointOfSale && order.pickupCode && order.fulfilmentMode === "PICKUP_PREPAID"
      ? await qrPngAttachment(order.pickupCode, `retrait-${order.orderNumber}.png`).catch((err) => {
          console.error("[fulfillOrderPayment] pickup QR generation failed:", err);
          return null;
        })
      : null;

  const emailAttachments = [
    ...(ticketPdf ? [{ filename: `ticket-${order.orderNumber}.pdf`, content: ticketPdf }] : []),
    ...(pickupQr ? [pickupQr] : []),
  ];

  sendEmail({
    to: order.user.email,
    subject: `Paiement confirmé – Commande n°${order.orderNumber} – Meri Beauty`,
    text:
      `Bonjour ${order.user.fullName},\n\n` +
      `Votre paiement de €${paidAmount.toFixed(2)} pour la commande n°${order.orderNumber} a bien été reçu. Votre ticket est joint à cet e-mail. ${pickupNote}${pendingInvoiceNote}\n\n` +
      `L'équipe Meri Beauty`,
    ...(emailAttachments.length ? { attachments: emailAttachments } : {}),
    html:
      `<p>Bonjour ${order.user.fullName},</p>` +
      `<p>Votre paiement de <strong>€${paidAmount.toFixed(2)}</strong> pour la commande n°${order.orderNumber} a bien été reçu. Votre ticket est joint à cet e-mail. ${pickupNote}</p>` +
      (pendingInvoiceNote ? `<p>${pendingInvoiceNote.trim()}</p>` : "") +
      (pickupQr ? `<p>Le QR code de retrait est joint à cet e-mail — présentez-le au comptoir, ou donnez simplement le code ci-dessus.</p>` : "") +
      `<p>L'équipe Meri Beauty</p>`,
  }).catch((err) => console.error("[fulfillOrderPayment] confirmation email failed:", err));

  return { received: true, processed: true };
}
