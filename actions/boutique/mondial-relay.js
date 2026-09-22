"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole, isTillCashOperator } from "@/lib/authorization";
import { createShipmentLabel } from "@/lib/mondial-relay";
import { storeShippingLabel } from "@/lib/mondial-relay-label-storage";
import { isBoutiqueShippingEnabledFor } from "@/lib/commerce-availability";
import { captureCriticalError } from "@/lib/monitoring";

// MONDIAL_RELAY_API_LOGIN / _API_PASSWORD / _CUSTOMER_ID are the "Connect"
// API V2.0 credentials — generated from Marie's Mondial Relay Connect
// account (connect.mondialrelay.com > Administration > Configuration des
// API > "API Version V2.0"), NOT the old Enseigne/private-key pair from her
// Shopify-era setup — that pair belongs to the now-retired WSI2 webservice.
//
// MONDIAL_RELAY_SENDER_* describe where the parcel physically ships FROM
// (Marie's shop/warehouse) — kept as their own env vars rather than parsed
// out of Salon.address, since the API needs name/street/house-number/postal
// code split out separately.
//
// MONDIAL_RELAY_COLLECTION_MODE captures how Marie hands the parcel to
// Mondial Relay: "REL" (she drops it off herself at a relay point) or "CCC"
// (a courier collects from her shop under a collection contract). Either
// way the location defaults to "Auto" — Mondial Relay picks the nearest
// relay to the sender address automatically, so no specific relay-point ID
// needs to be sourced from Marie up front.
const REQUIRED_ENV = [
  "MONDIAL_RELAY_API_LOGIN",
  "MONDIAL_RELAY_API_PASSWORD",
  "MONDIAL_RELAY_CUSTOMER_ID",
  "MONDIAL_RELAY_SENDER_NAME",
  "MONDIAL_RELAY_SENDER_STREET",
  "MONDIAL_RELAY_SENDER_HOUSE_NO",
  "MONDIAL_RELAY_SENDER_POSTAL_CODE",
  "MONDIAL_RELAY_SENDER_CITY",
  "MONDIAL_RELAY_SENDER_PHONE",
];

function missingConfig() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

async function requireLabelAccess() {
  const session = await auth();
  if (!session?.user || !isTillCashOperator(session.user)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

export async function generateShippingLabel(orderId) {
  const guard = await requireLabelAccess();
  if (guard.error) return { success: false, message: guard.error };

  const missing = missingConfig();
  if (missing.length > 0) {
    console.error("[generateShippingLabel] missing env vars:", missing.join(", "));
    return {
      success: false,
      message: "Identifiants ou configuration Mondial Relay incomplets — ajoutez le numéro de suivi manuellement en attendant.",
    };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { fullName: true, phone: true, email: true } },
      items: { include: { variant: { select: { weightGrams: true } } } },
    },
  });
  // labelRequestedAt/trackingCode/pickupPointId etc. all come through via
  // the model's own scalar fields on `order` above (findUnique returns
  // every scalar column by default) — no separate select needed.
  if (!order) return { success: false, message: "Commande introuvable." };
  if (order.fulfilmentMode !== "SHIPPING_PREPAID") {
    return { success: false, message: "Cette commande n'est pas à expédier." };
  }
  // Defense in depth on top of the checkout-time gate (createOrderFromCart):
  // while the Mondial Relay pilot allowlist is configured, no non-pilot
  // order should exist as SHIPPING_PREPAID at all — but a stale order from
  // before the pilot started, or a manually edited one, shouldn't silently
  // buy a real label outside the pilot either.
  if (!isBoutiqueShippingEnabledFor(order.user?.email)) {
    return { success: false, message: "La livraison Mondial Relay est actuellement limitée au pilote interne." };
  }
  // A real label costs real postage — refuse to buy one for an order that
  // hasn't actually been paid (PENDING_PAYMENT), or that's no longer
  // fulfillable (CANCELLED/EXPIRED/SHIPPED/COMPLETED). PAID/PROCESSING are
  // the only states between "money collected" and "already shipped".
  if (!["PAID", "PROCESSING"].includes(order.status)) {
    return { success: false, message: "Cette commande n'est pas payée ou n'est plus dans un état permettant de générer une étiquette." };
  }
  // Idempotency (fast-path message only — the atomic claim below is what
  // actually closes the race). A second call would buy and pay for a second
  // real label, and overwrite the first trackingCode with no way to
  // reconcile which label actually got used.
  if (order.trackingCode) {
    return {
      success: false,
      message: `Une étiquette a déjà été générée pour cette commande (n° de suivi : ${order.trackingCode}).`,
    };
  }
  if (order.labelRequestedAt) {
    return {
      success: false,
      message: "Une génération d'étiquette est déjà en cours ou son résultat n'a pas encore été confirmé pour cette commande. Vérifiez le portail Mondial Relay ; un administrateur peut débloquer la commande si aucune étiquette n'a été créée.",
    };
  }
  if (!order.pickupPointId) {
    return {
      success: false,
      message: "Point relais non renseigné via le widget — impossible de générer une étiquette automatiquement pour cette commande.",
    };
  }

  // Atomic claim, BEFORE calling Mondial Relay — this, not the write after
  // the call, is what actually prevents two concurrent clicks (two tabs,
  // two staff, a slow network) from both reaching the carrier and buying
  // two real, billed shipments for the same order. Only the request that
  // wins this update is allowed to call out.
  const claim = await prisma.order.updateMany({
    where: { id: orderId, trackingCode: null, labelRequestedAt: null },
    data: { labelRequestedAt: new Date() },
  });
  if (claim.count === 0) {
    return {
      success: false,
      message: "Une étiquette a déjà été générée, ou une génération est déjà en cours pour cette commande.",
    };
  }

  const totalWeightGrams = order.items.reduce(
    (total, item) => total + (item.variant?.weightGrams || 0) * item.quantity,
    0
  );
  // Mondial Relay requires a strictly positive weight (10g minimum) — fall
  // back to a conservative 500g for orders whose variants have no weight
  // recorded rather than sending "0" and risking an outright rejection.
  const weightGrams = totalWeightGrams > 0 ? totalWeightGrams : 500;

  const result = await createShipmentLabel({
    credentials: {
      login: process.env.MONDIAL_RELAY_API_LOGIN,
      password: process.env.MONDIAL_RELAY_API_PASSWORD,
      customerId: process.env.MONDIAL_RELAY_CUSTOMER_ID,
    },
    sender: {
      name: process.env.MONDIAL_RELAY_SENDER_NAME,
      street: process.env.MONDIAL_RELAY_SENDER_STREET,
      houseNo: process.env.MONDIAL_RELAY_SENDER_HOUSE_NO,
      countryCode: "BE",
      postCode: process.env.MONDIAL_RELAY_SENDER_POSTAL_CODE,
      city: process.env.MONDIAL_RELAY_SENDER_CITY,
      phone: process.env.MONDIAL_RELAY_SENDER_PHONE,
      email: process.env.MONDIAL_RELAY_SENDER_EMAIL || "",
    },
    recipient: {
      name: order.user?.fullName || "Client",
      // Final delivery is to the relay point, not the customer's home —
      // we never collect the customer's home address for Mondial Relay
      // pickup-point orders, so the relay's own address stands in here as
      // reference text. Physical routing uses deliveryMode.location below.
      street: order.pickupPointAddress || "",
      houseNo: "",
      countryCode: "BE",
      postCode: order.pickupPointPostalCode || "",
      city: order.pickupPointCity || "",
      phone: order.user?.phone || "",
      email: order.user?.email || "",
    },
    deliveryMode: { mode: "24R", location: order.pickupPointId },
    collectionMode: {
      mode: process.env.MONDIAL_RELAY_COLLECTION_MODE || "REL",
      location: process.env.MONDIAL_RELAY_COLLECTION_POINT_ID || "Auto",
    },
    weightGrams,
    orderNo: String(order.orderNumber),
  });

  if (!result.success) {
    if (result.uncertain) {
      // We never got a response — Mondial Relay may have created the
      // shipment anyway. Deliberately do NOT clear labelRequestedAt here: a
      // retry on this outcome is exactly what could buy a second real,
      // billed shipment. Only clearStuckLabelClaim (admin, after checking
      // the MR portal) can unblock this order again.
      await prisma.order.update({
        where: { id: orderId },
        data: { labelRawResponse: result.rawResponse ?? null },
      });
      captureCriticalError(new Error("Mondial Relay label creation outcome unknown"), {
        area: "mondial-relay",
        orderId,
        orderNumber: order.orderNumber,
      });
      return { success: false, message: result.message };
    }

    // A confirmed rejection (bad credentials, invalid pickup point, weight
    // out of range, …) — Mondial Relay told us nothing was created, so the
    // claim is released and staff can fix the input and retry immediately.
    await prisma.order.update({
      where: { id: orderId },
      data: { labelRequestedAt: null, labelRawResponse: result.rawResponse ?? null },
    });
    return { success: false, message: result.message || "Échec de la génération de l'étiquette Mondial Relay." };
  }

  // The label is bought and billed regardless of what happens next — keep
  // our own copy so a blocked popup or a closed tab never loses it (see
  // lib/mondial-relay-label-storage.js). Best-effort: a failure here must
  // not be treated as the label purchase having failed.
  const stored = await storeShippingLabel(orderId, result.labelUrl);
  if (!stored) {
    captureCriticalError(new Error("Mondial Relay label PDF could not be stored locally"), {
      area: "mondial-relay",
      orderId,
      orderNumber: order.orderNumber,
      shipmentNumber: result.shipmentNumber,
    });
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      trackingCode: result.shipmentNumber,
      labelUrl: result.labelUrl,
      labelRawResponse: result.rawResponse ?? null,
    },
  });

  return {
    success: true,
    message: "Étiquette Mondial Relay générée avec succès.",
    data: { trackingCode: result.shipmentNumber, labelUrl: result.labelUrl },
  };
}

/**
 * Admin-only escape hatch for an order stuck in the "uncertain" state above
 * (labelRequestedAt set, trackingCode still null) — a timeout or lost
 * response left the app unable to tell whether Mondial Relay created the
 * shipment. This must only be used after a human has actually checked the
 * Mondial Relay portal and confirmed nothing was created; it does not check
 * that itself, it just records who cleared it.
 */
export async function clearStuckLabelClaim(orderId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Seul un administrateur peut débloquer une génération d'étiquette." };
  }

  const claim = await prisma.order.updateMany({
    where: { id: orderId, trackingCode: null, labelRequestedAt: { not: null } },
    data: { labelRequestedAt: null },
  });
  if (claim.count === 0) {
    return {
      success: false,
      message: "Rien à débloquer pour cette commande — vérifiez qu'aucune étiquette n'a déjà été enregistrée.",
    };
  }

  console.log(`[clearStuckLabelClaim] order ${orderId} unblocked by ${session.user.email ?? session.user.id}`);
  return {
    success: true,
    message: "Verrou levé. Une nouvelle génération est possible — vérifiez d'abord sur le portail Mondial Relay qu'aucune étiquette n'existe déjà pour cette commande.",
  };
}
