"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";

/**
 * Mondial Relay label generation (WSI2/WSI4 webservice — "expedition
 * creation" endpoint). Needs MONDIAL_RELAY_API_LOGIN + MONDIAL_RELAY_API_KEY,
 * the private webservice credentials — separate from, and heavier than, the
 * NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID used by the checkout pickup-point widget.
 * Marie needs to confirm whether her old Shopify-era Mondial Relay account
 * still has these before this can go live.
 *
 * Real implementation sketch (fast-follow once credentials exist):
 *   - Build the WSI2 "WSI2_CreationV2" SOAP request: Enseigne (=API_LOGIN),
 *     ModeCol="REL", ModeLiv="24R", pickup point Num (order.pickupPointId),
 *     recipient name/address, weight, and a Security field = uppercase
 *     MD5(concatenated params + API_KEY).
 *   - On success, store the returned "ExpeditionNum" as order.trackingCode
 *     and the returned label URL/PDF for the "Générer l'étiquette" download.
 */
export async function generateShippingLabel(orderId) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
    return { success: false, message: "Accès non autorisé." };
  }

  if (!process.env.MONDIAL_RELAY_API_LOGIN || !process.env.MONDIAL_RELAY_API_KEY) {
    return {
      success: false,
      message: "Identifiants Mondial Relay non configurés — ajoutez le numéro de suivi manuellement en attendant.",
    };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
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

  // Real WSI2 call goes here once credentials are confirmed — see sketch above.
  return { success: false, message: "Génération d'étiquette Mondial Relay pas encore implémentée." };
}
