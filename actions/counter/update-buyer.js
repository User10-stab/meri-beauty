"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
import { resolveCounterCustomer } from "@/lib/counter/resolve-counter-customer";
import { CounterCustomerError } from "@/lib/reservation-errors";

const completeBuyerSchema = z.object({
  userId: z.string().min(1),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional().nullable(),
  addressCity: z.string().trim().optional(),
  addressPostalCode: z.string().trim().optional(),
  addressCountry: z.string().trim().optional(),
  vatNumber: z.string().trim().max(30).optional(),
});

/**
 * Fills gaps on the buyer already attached to a booking — a VAT number or a
 * billing address missing from their account. This never reassigns *who*
 * the buyer is: the check-in QR, the confirmation e-mail and any invoice
 * already went to this person, and any of those a swap would orphan is left
 * alone (see the unified-counter plan's buyer-reassignment trap). It only
 * completes what is missing on their own User row, through the same
 * VAT/VIES and address rules every other counter flow already uses.
 */
export async function completeCounterBuyer(input) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE))) {
    return { success: false, message: "Accès non autorisé." };
  }

  const parsed = completeBuyerSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const { userId, addressLine1, vatNumber } = parsed.data;
  if (!vatNumber && !addressLine1) {
    return { success: false, message: "Ajoutez un numéro de TVA ou une adresse avant d'enregistrer." };
  }

  try {
    const user = await resolveCounterCustomer(prisma, parsed.data);
    return {
      success: true,
      message: "Informations client complétées.",
      data: {
        userId: user.id,
        vatNumber: user.vatNumber,
        vatInvoiceReady: Boolean(user.vatValidatedAt),
        addressLine1: user.addressLine1,
        addressCity: user.addressCity,
        addressPostalCode: user.addressPostalCode,
        addressCountry: user.addressCountry,
      },
    };
  } catch (error) {
    if (error instanceof CounterCustomerError) {
      return { success: false, message: error.message };
    }
    console.error("[completeCounterBuyer]", error);
    return { success: false, message: "Impossible de compléter les informations du client." };
  }
}
