"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";
import { createShipmentLabel } from "@/lib/mondial-relay";

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

export async function generateShippingLabel(orderId) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
    return { success: false, message: "Accès non autorisé." };
  }

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
  if (!order) return { success: false, message: "Commande introuvable." };
  if (order.fulfilmentMode !== "SHIPPING_PREPAID") {
    return { success: false, message: "Cette commande n'est pas à expédier." };
  }
  if (!order.pickupPointId) {
    return {
      success: false,
      message: "Point relais non renseigné via le widget — impossible de générer une étiquette automatiquement pour cette commande.",
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
    return { success: false, message: result.message || "Échec de la génération de l'étiquette Mondial Relay." };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { trackingCode: result.shipmentNumber },
  });

  return {
    success: true,
    message: "Étiquette Mondial Relay générée avec succès.",
    data: { trackingCode: result.shipmentNumber, labelUrl: result.labelUrl },
  };
}
