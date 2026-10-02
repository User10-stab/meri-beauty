"use client";

import { useEffect } from "react";
import { trackConversion } from "@/lib/analytics";

/**
 * Conversion GA4 boutique : événement `purchase` (nom imposé par Google
 * pour le suivi du chiffre d'affaires). À marquer comme événement clé
 * dans GA4 avec appointment_booked, workshop_booked et formation_booked :
 * le total Conversions du dashboard vaut alors exactement ces 4 actes.
 */
export function PurchaseTracker({ transactionId, amount }) {
  useEffect(() => {
    trackConversion(
      "purchase",
      {
        ...(amount != null && Number.isFinite(Number(amount)) ? { value: Number(amount), currency: "EUR" } : {}),
        ...(transactionId ? { transaction_id: transactionId } : {}),
      },
      transactionId ?? "boutique"
    );
  }, [transactionId, amount]);
  return null;
}
